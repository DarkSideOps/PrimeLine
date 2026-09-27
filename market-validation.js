(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.PrimeLineValidation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const MAX_AGE_MS=15*60*1000;
  const validAmerican=o=>o!=null&&Number.isFinite(Number(o))&&Math.abs(Number(o))>=100&&Math.abs(Number(o))<=5000;
  const halfPoint=n=>Number.isFinite(Number(n))&&Math.abs(Number(n)*2-Math.round(Number(n)*2))<0.001;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tier=c=>c>=95?'Elite':c>=90?'Very Strong':c>=85?'Strong':c>=80?'Moderate':'Developing';
  function baseValid(m,now=Date.now()){
    if(!m||m.is_live!==false||m.is_available!==true||!m.sportsbook_id||!m.provider_market_id||!m.provider_outcome_id||!m.observed_at)return false;
    if(String(m.sportsbook_name||'').trim().toLowerCase()==='scrambled')return false;
    if(m.entitlement&&m.entitlement!=='production')return false;
    if(m.is_alternate!==false)return false;
    const t=new Date(m.provider_updated_at||m.observed_at).getTime();
    return Number.isFinite(t)&&now-t>=0&&now-t<=MAX_AGE_MS;
  }
  function rowValid(m,sport,now){
    if(!baseValid(m,now)||!validAmerican(m.american_odds))return false;
    if(m.market_type==='moneyline')return true;
    if(m.line==null)return false;
    const n=Number(m.line);
    if(m.market_type==='spread')return Math.abs(n)<=35&&halfPoint(n);
    if(m.market_type==='total'){const lo=sport==='NFL'?25:20,hi=sport==='NFL'?80:100;return n>=lo&&n<=hi&&halfPoint(n)}
    return false;
  }
  function pairMarkets(rows,type,sides,sport,now=Date.now()){
    const usable=(rows||[]).filter(m=>m.market_type===type&&sides.includes(m.side)&&rowValid(m,sport,now));
    const groups=new Map();
    for(const m of usable){const k=[m.sportsbook_id,m.observed_at,m.provider_market_id].join('|');(groups.get(k)||groups.set(k,[]).get(k)).push(m)}
    const pairs=[];
    for(const group of groups.values()){
      const p={}; for(const m of group)p[m.side]=m;
      if(sides.every(s=>p[s])){
        if(type==='spread'&&Math.abs(Number(p.home.line)+Number(p.away.line))>0.001)continue;
        if(type==='total'&&Number(p.over.line)!==Number(p.under.line))continue;
        pairs.push(p);
      }
    }
    pairs.sort((a,b)=>new Date(b[sides[0]].observed_at)-new Date(a[sides[0]].observed_at));
    return pairs[0]||null;
  }
  function recommendationValid(rec,pairs){
    if(!rec||rec.status!=='active'||!rec.market_type||!rec.side)return false;
    const pair=pairs[rec.market_type]; if(!pair||!pair[rec.side])return false;
    const m=pair[rec.side];
    if(rec.sportsbook_id&&rec.sportsbook_id!==m.sportsbook_id)return false;
    if(rec.provider_outcome_id&&rec.provider_outcome_id!==m.provider_outcome_id)return false;
    if(rec.line!=null&&m.line!=null&&Number(rec.line)!==Number(m.line))return false;
    return !!rec.provider_outcome_id;
  }
  return {MAX_AGE_MS,validAmerican,halfPoint,esc,tier,baseValid,rowValid,pairMarkets,recommendationValid};
});