import { randomUUID } from 'node:crypto';
export function auctions(db,{query,run,transaction,required,whole,fail,now,deliveries,exchange}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auctions (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), offer TEXT NOT NULL REFERENCES publisher_offers(id),
      reference TEXT NOT NULL, region TEXT NOT NULL, floor INTEGER NOT NULL, deadline TEXT NOT NULL,
      state TEXT NOT NULL, call TEXT REFERENCES network_calls(id), created TEXT NOT NULL, UNIQUE(account,reference)
    );
    CREATE TABLE IF NOT EXISTS auction_targets (
      auction TEXT NOT NULL REFERENCES auctions(id), buyer TEXT NOT NULL REFERENCES buyers(id), PRIMARY KEY(auction,buyer)
    );
    CREATE TABLE IF NOT EXISTS auction_bids (
      auction TEXT NOT NULL REFERENCES auctions(id), buyer TEXT NOT NULL REFERENCES buyers(id),
      cents INTEGER NOT NULL, timely INTEGER NOT NULL, created TEXT NOT NULL, PRIMARY KEY(auction,buyer)
    );
  `);
  function finish(id,force=false) {
    return transaction(()=>{
      const [auction]=query('SELECT * FROM auctions WHERE id=?',id);
      if (!auction) fail('Unknown auction.',404);
      if (auction.state!=='open') return auction;
      const targets=query('SELECT buyer FROM auction_targets WHERE auction=?',id);
      const bids=query('SELECT * FROM auction_bids WHERE auction=?',id);
      if (!force && auction.deadline>now() && bids.length<targets.length) return auction;
      const accepted=new Map(bids.filter(row=>row.timely && row.cents>0).map(row=>[row.buyer,row.cents]));
      const result=exchange.award(auction.account,{
        offer:auction.offer,reference:'auction:'+id,region:auction.region,floor:auction.floor,strategy:'price'
      },accepted);
      run("UPDATE auctions SET state='complete',call=? WHERE id=?",result.id,id);
      return {...auction,state:'complete',call:result.id};
    });
  }
  return {
    read(account) {
      for (const row of query("SELECT id FROM auctions WHERE account=? AND state='open' AND deadline<=?",account,now())) finish(row.id);
      return query(`SELECT a.*,c.buyer,c.outcome,c.revenue,d.bid FROM auctions a LEFT JOIN network_calls c ON c.id=a.call
        LEFT JOIN network_decisions d ON d.call=c.id WHERE a.account=? ORDER BY a.created DESC LIMIT 100`,account)
        .map(row=>({...row,bids:query(`SELECT b.name,r.cents,r.timely,r.created FROM auction_bids r JOIN buyers b ON b.id=r.buyer
          WHERE r.auction=? ORDER BY r.cents DESC`,row.id)}));
    },
    open(user,data) {
      if (user.role==='viewer') fail('Read-only account.',403);
      const offer=required(data.offer,'offer'),reference=required(data.reference,'auction reference');
      const region=required(data.region,'region').toUpperCase();
      if (!/^[A-Z]{2}$/.test(region)) fail('Choose a two-letter region.');
      const floor=whole(data.floor,1000000),timeout=whole(data.timeout,10000);
      if (timeout<200) fail('Choose a timeout from 200 to 10,000 ms.');
      return transaction(()=>{
        const [prior]=query('SELECT * FROM auctions WHERE account=? AND reference=?',user.account,reference);
        if (prior) {
          if (prior.offer!==offer||prior.region!==region||prior.floor!==floor) fail('Auction reference conflict.',409);
          return prior;
        }
        if (!query('SELECT id FROM publisher_offers WHERE id=? AND account=?',offer,user.account).length) fail('Unknown offer.',404);
        const id=randomUUID(),deadline=new Date(Date.parse(now())+timeout).toISOString();
        run("INSERT INTO auctions VALUES (?,?,?,?,?,?,?,'open',NULL,?)",id,user.account,offer,reference,region,floor,deadline,now());
        const targets=query('SELECT id FROM buyers WHERE account=? AND region=?',user.account,region);
        for (const buyer of targets) {
          run('INSERT INTO auction_targets VALUES (?,?)',id,buyer.id);
          deliveries.enqueue(user.account,'bidding',id+':'+buyer.id,{type:'buyer.bid-request',auction:id,buyer:buyer.id,region,floor,deadline});
        }
        if (!targets.length) return finish(id,true);
        return {id,deadline,state:'open'};
      });
    },
    event(data) {
      const id=required(data.request,'auction'),buyer=required(data.buyer,'buyer');
      const cents=whole(data.cents,1000000);
      return transaction(()=>{
        const [auction]=query('SELECT * FROM auctions WHERE id=?',id);
        if (!auction||!query('SELECT buyer FROM auction_targets WHERE auction=? AND buyer=?',id,buyer).length) fail('Unknown auction target.',404);
        const [prior]=query('SELECT cents FROM auction_bids WHERE auction=? AND buyer=?',id,buyer);
        if (prior) {
          if (prior.cents!==cents) fail('Buyer response already recorded.',409);
          return {recorded:true};
        }
        run('INSERT INTO auction_bids VALUES (?,?,?,?,?)',id,buyer,cents,Number(auction.state==='open'&&auction.deadline>=now()),now());
        finish(id);
        return {recorded:true};
      });
    },
    expire(account) {
      for (const row of query("SELECT id FROM auctions WHERE account=? AND state='open' AND deadline<=?",account,now())) finish(row.id);
    }
  };
}
