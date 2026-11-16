(function initializeVpsDataClient() {
    const API_ROOT = '/webgis-api';
    const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

    const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

    class VpsQuery {
        constructor(resource, params = new URLSearchParams()) {
            this.resource = resource;
            this.params = params;
            this.countMode = null;
            this.headOnly = false;
            this.singleRow = false;
        }

        select(columns = '*', options = {}) {
            this.params.set('select', columns);
            this.countMode = options.count || null;
            this.headOnly = options.head === true;
            return this;
        }

        eq(column, value) {
            this.params.set(column, `eq.${value}`);
            return this;
        }

        in(column, values) {
            // PostgREST list syntax; quoting keeps commas and parentheses in values.
            const quoted = values.map(value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
            this.params.set(column, `in.(${quoted.join(',')})`);
            return this;
        }

        not(column, operator, value) {
            const encodedValue = value === null ? 'null' : value;
            this.params.set(column, `not.${operator}.${encodedValue}`);
            return this;
        }

        order(column, { ascending = true } = {}) {
            this.params.set('order', `${column}.${ascending ? 'asc' : 'desc'}`);
            return this;
        }

        range(from, to) {
            this.params.set('offset', String(from));
            this.params.set('limit', String(to - from + 1));
            return this;
        }

        limit(count) {
            this.params.set('limit', String(count));
            return this;
        }

        single() {
            this.singleRow = true;
            return this;
        }

        then(onFulfilled, onRejected) {
            return this.execute().then(onFulfilled, onRejected);
        }

        catch(onRejected) {
            return this.execute().catch(onRejected);
        }

        async execute() {
            const query = this.params.toString();
            const url = `${API_ROOT}/${this.resource}${query ? `?${query}` : ''}`;
            const headers = { Accept: this.singleRow ? 'application/vnd.pgrst.object+json' : 'application/json' };
            if (this.countMode) headers.Prefer = `count=${this.countMode}`;

            let lastError;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    const response = await fetch(url, {
                        method: this.headOnly ? 'HEAD' : 'GET',
                        headers,
                    });

                    if (RETRYABLE_STATUS.has(response.status) && attempt < 2) {
                        await delay(150 * (2 ** attempt));
                        continue;
                    }

                    const contentRange = response.headers.get('content-range');
                    const total = contentRange?.split('/').at(-1);
                    const count = total && total !== '*' ? Number(total) : null;
                    const body = this.headOnly ? '' : await response.text();

                    if (!response.ok) {
                        let details;
                        try {
                            details = body ? JSON.parse(body) : {};
                        } catch {
                            details = {};
                        }
                        return {
                            data: null,
                            error: {
                                message: details.message || `Data request failed (${response.status})`,
                                code: details.code || String(response.status),
                                details: details.details || null,
                                hint: details.hint || null,
                            },
                            count,
                        };
                    }

                    return {
                        data: body ? JSON.parse(body) : null,
                        error: null,
                        count,
                    };
                } catch (error) {
                    lastError = error;
                    if (attempt < 2) await delay(150 * (2 ** attempt));
                }
            }

            return {
                data: null,
                error: { message: lastError?.message || 'Data request failed' },
                count: null,
            };
        }
    }

    class VpsDataClient {
        from(table) {
            return new VpsQuery(encodeURIComponent(table));
        }

        rpc(functionName, parameters = {}, options = {}) {
            const queryParams = new URLSearchParams();
            Object.entries(parameters).forEach(([name, value]) => {
                if (value !== null && value !== undefined && value !== '') {
                    queryParams.set(name, String(value));
                }
            });

            const query = new VpsQuery(`rpc/${encodeURIComponent(functionName)}`, queryParams);
            query.countMode = options.count || null;
            if (options.range) query.range(options.range[0], options.range[1]);
            return query;
        }
    }

    window.nkuaDataClient = new VpsDataClient();
    window.vpsDataClient = window.nkuaDataClient;
    window.supabaseClient = window.nkuaDataClient;
})();
