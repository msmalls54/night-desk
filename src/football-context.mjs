import {json} from './providers.mjs';
import {config} from './config.mjs';
export const footballEvent={espn_id:'401866415',event_ticker:'KXNCAAFGAME-26SEP12COLGCMU',colgate_ticker:'KXNCAAFGAME-26SEP12COLGCMU-COLG',yes_ticker:'KXNCAAFGAME-26SEP12COLGCMU-COLG',date:'2026-09-12',team_ids:['2117','2142']};
export const wyomingEvent={espn_id:'401864506',event_ticker:'KXNCAAFGAME-26SEP12UNCOWYO',yes_ticker:'KXNCAAFGAME-26SEP12UNCOWYO-WYO',date:'2026-09-12',team_ids:['2751','2458']};
export const supportedGameEvents=[footballEvent,wyomingEvent];
function verifiedEvent(event){
  const known=supportedGameEvents.find(e=>e.espn_id===event?.espn_id&&e.event_ticker===event?.event_ticker);
  if(!known||event.date!==known.date||event.yes_ticker!==known.yes_ticker||!Array.isArray(event.team_ids)||[...event.team_ids].sort().join(',')!==[...known.team_ids].sort().join(','))throw new Error('Unsupported football event identity');
  return known;
}
export async function espnGame(event=footballEvent){
  event=verifiedEvent(event);
  const url='https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event='+event.espn_id;
  const d=await json(url),g=d.header?.competitions?.[0];
  if(d.header?.id!==event.espn_id||g?.date?.slice(0,10)!==event.date||g.competitors?.map(t=>t.team?.id).sort().join(',')!==[...event.team_ids].sort().join(','))throw new Error('ESPN matchup identity mismatch');
  const wanted=new Set(['totalYards','turnovers','rushingYards','netPassingYards','thirdDownEff','possessionTime']);
  return {at:new Date().toISOString(),source:'ESPN game snapshot; may lag play on the field',url:'https://www.espn.com/college-football/game/_/gameId/'+event.espn_id,game_id:d.header.id,event_ticker:event.event_ticker,date:g.date,source_updated_at:d.meta?.lastUpdatedAt||null,status:g.status,teams:g.competitors.map(t=>({id:t.team.id,name:t.team.displayName,homeAway:t.homeAway,score:t.score,possession:t.possession})),statistics:d.boxscore?.teams?.map(t=>({team_id:t.team.id,values:t.statistics.filter(s=>wanted.has(s.name)).map(s=>({name:s.name,value:s.displayValue}))})),espn_home_win_probability:d.winprobability?.at(-1)||null};
}
export async function footballMarkets(event=footballEvent){
  event=verifiedEvent(event);
  const base='https://external-api.demo.kalshi.co/trade-api/v2';
  const [d,s,f]=await Promise.all([json(base+'/markets?event_ticker='+event.event_ticker+'&limit=100'),json(base+'/series/KXNCAAFGAME'),json(base+'/events/fee_changes?event_ticker='+event.event_ticker+'&limit=100')]);
  if(d.cursor||!Array.isArray(d.markets)||!d.markets.some(m=>m.ticker===event.yes_ticker)||d.markets.some(m=>m.event_ticker!==event.event_ticker||m.market_type!=='binary'))throw new Error('Kalshi game market identity mismatch or incomplete page');
  const fees_verified=s.series?.fee_type==='quadratic'&&Number.isFinite(s.series.fee_multiplier)&&!f.cursor&&Array.isArray(f.event_fee_changes)&&f.event_fee_changes.length===0;
  return {at:new Date().toISOString(),source:'Kalshi DEMO quotes; not live-exchange prices',event_ticker:event.event_ticker,yes_ticker:event.yes_ticker,espn_game_id:event.espn_id,fees_verified,fee_multiplier:fees_verified?s.series.fee_multiplier:null,markets:d.markets.map(m=>({ticker:m.ticker,event_ticker:m.event_ticker,market_type:m.market_type,title:m.title,yes_sub_title:m.yes_sub_title,status:m.status,yes_bid_dollars:m.yes_bid_dollars,yes_ask_dollars:m.yes_ask_dollars,no_bid_dollars:m.no_bid_dollars,no_ask_dollars:m.no_ask_dollars,rules_primary:m.rules_primary,rules_secondary:m.rules_secondary,close_time:m.close_time}))};
}
export async function football(){const event=config.FOOTBALL_EVENT==='wyoming'?wyomingEvent:footballEvent;const [game,markets]=await Promise.all([espnGame(event),footballMarkets(event)]);return {at:new Date().toISOString(),event,game,markets};}
