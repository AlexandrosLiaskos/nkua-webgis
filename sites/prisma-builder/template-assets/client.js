(() => {
  const toggle=document.querySelector('[data-nav-toggle]');
  const nav=document.getElementById('primary-navigation');
  const media=window.matchMedia('(max-width: 70rem)');
  const setNav=open=>{if(!toggle||!nav)return;toggle.hidden=!media.matches;nav.hidden=media.matches&&!open;toggle.setAttribute('aria-expanded',String(media.matches&&open));};
  if(toggle&&nav){setNav(false);toggle.addEventListener('click',()=>setNav(toggle.getAttribute('aria-expanded')!=='true'));media.addEventListener('change',()=>setNav(false));document.addEventListener('keydown',e=>{if(e.key==='Escape'){setNav(false);toggle.focus();}});}
  const host=document.querySelector('[data-catalogue-index]');
  if(!host)return;
  const form=host.querySelector('[data-index-filters]');
  const body=host.querySelector('[data-index-rows]');
  const counter=host.querySelector('[data-result-count]');
  const message=host.querySelector('[data-index-message]');
  const pager=host.querySelector('[data-pagination]');
  const next=host.querySelector('[data-next]');const previous=host.querySelector('[data-previous]');
  let data=null,page=Number(host.dataset.page)||1,timer;
  const params=new URLSearchParams(location.search);
  for(const element of form.elements)if(element.name&&params.has(element.name))element.value=params.get(element.name);
  function render(updateUrl=true){
    if(!data)return;
    const filters=Object.fromEntries(new FormData(form));const query=(filters.q||'').trim().toLocaleLowerCase('en');
    const rows=data.rows.filter(r=>(!query||r.search.includes(query))&&Object.entries(filters).every(([k,v])=>k==='q'||!v||r.filters[k]===v));
    const pages=Math.max(1,Math.ceil(rows.length/50));page=Math.max(1,Math.min(page,pages));
    const fragment=document.createDocumentFragment();
    for(const row of rows.slice((page-1)*50,page*50)){
      const tr=document.createElement('tr');
      row.values.forEach((value,i)=>{const cell=document.createElement(i?'td':'th');if(i){cell.dataset.label=data.columns[i];cell.textContent=value;}else{cell.scope='row';const a=document.createElement('a');a.className='resource-title-link';a.href=host.dataset.root+row.path;if(host.dataset.preview==='true'){a.href='#';a.dataset.previewPage=row.path;}a.textContent=value;cell.append(a);}tr.append(cell);});fragment.append(tr);
    }
    body.replaceChildren(fragment);counter.textContent=`${rows.length.toLocaleString('en')} of ${data.rows.length.toLocaleString('en')} records`;
    host.querySelector('[data-empty]').hidden=rows.length>0;
    pager.hidden=rows.length<=50;previous.disabled=page<=1;next.disabled=page>=pages;host.querySelector('[data-page-label]').textContent=`Page ${page} of ${pages}`;
    host.querySelector('.static-pages')?.setAttribute('hidden','');
    if(updateUrl&&host.dataset.preview!=='true'){const nextParams=new URLSearchParams();for(const [k,v] of Object.entries(filters))if(v)nextParams.set(k,v);nextParams.set('page',String(page));history.replaceState(null,'',location.pathname+'?'+nextParams+location.hash);}
  }
  async function load(){try{const inline=document.querySelector('[data-inline-index]');if(inline){data=JSON.parse(inline.textContent);}else{const response=await fetch(host.dataset.source);if(!response.ok)throw new Error('HTTP '+response.status);data=await response.json();}page=Number(params.get('page'))||page;render(false);}catch(error){message.hidden=false;message.textContent='Interactive search could not load. The catalogue pages and downloads remain available.';}}
  form.addEventListener('input',e=>{if(e.target.tagName==='SELECT')return;clearTimeout(timer);timer=setTimeout(()=>{page=1;render();},120);});
  form.addEventListener('change',e=>{if(e.target.tagName!=='SELECT')return;clearTimeout(timer);page=1;render();});form.addEventListener('submit',e=>e.preventDefault());
  form.addEventListener('reset',()=>{clearTimeout(timer);setTimeout(()=>{page=1;render();},0);});
  next.addEventListener('click',()=>{page++;render();host.scrollIntoView({behavior:'auto'});});previous.addEventListener('click',()=>{page--;render();host.scrollIntoView({behavior:'auto'});});
  load();
})();
