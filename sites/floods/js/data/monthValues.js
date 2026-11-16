export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export function formatMonth(value) {
    return MONTH_NAMES[Number(value) - 1] || String(value);
}

export function getFloodMonth(date) {
    const match = String(date || '').trim().match(/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/);
    return match ? Number(match[1]) : null;
}
