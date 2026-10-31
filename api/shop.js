import { neon } from '@neondatabase/serverless';

const json=(res,status,data)=>{res.status(status).setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify(data))};
const cleanSlug=v=>String(v||'').toLowerCase().trim().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
const clean=v=>String(v||'').trim().slice(0,500);

export default async function handler(req,res){
  if(!process.env.DATABASE_URL) return json(res,503,{error:'Database is not connected yet.'});
  const sql=neon(process.env.DATABASE_URL);
  try{
    if(req.method==='GET'){
      const slug=cleanSlug(req.query.slug);
      const ownerKey=clean(req.headers['x-owner-key']);
      if(ownerKey){
        const shops=await sql`SELECT id,slug,business_name,owner_name FROM shops WHERE owner_key=${ownerKey} LIMIT 1`;
        if(!shops.length)return json(res,404,{error:'Shop not found'});
        const shop=shops[0];
        const orders=await sql`SELECT id,order_number,customer_name,customer_phone,service,details,amount,status,due_text,source,created_at FROM orders WHERE shop_id=${shop.id} ORDER BY created_at DESC`;
        return json(res,200,{shop,orders});
      }
      if(!slug)return json(res,400,{error:'Shop URL is required'});
      const shops=await sql`SELECT slug,business_name FROM shops WHERE slug=${slug} LIMIT 1`;
      if(!shops.length)return json(res,404,{error:'This shop link does not exist.'});
      return json(res,200,{shop:shops[0]});
    }

    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    if(req.method==='POST'&&body.action==='register'){
      const slug=cleanSlug(body.slug), business=clean(body.business), owner=clean(body.ownerName), ownerKey=clean(body.ownerKey);
      if(!slug||!business||!owner||ownerKey.length<20)return json(res,400,{error:'Missing shop registration details'});
      const exists=await sql`SELECT 1 FROM shops WHERE slug=${slug} LIMIT 1`;
      if(exists.length)return json(res,409,{error:'That shop URL is already taken.'});
      const rows=await sql`INSERT INTO shops(slug,business_name,owner_name,owner_key) VALUES(${slug},${business},${owner},${ownerKey}) ON CONFLICT(owner_key) DO UPDATE SET business_name=EXCLUDED.business_name,owner_name=EXCLUDED.owner_name RETURNING slug,business_name,owner_name`;
      return json(res,201,{shop:rows[0]});
    }

    if(req.method==='POST'&&body.action==='public-order'){
      const slug=cleanSlug(body.slug), customer=clean(body.customer), phone=clean(body.phone), service=clean(body.service), details=clean(body.details);
      if(!slug||!customer||!service)return json(res,400,{error:'Customer name and print job are required.'});
      const shops=await sql`SELECT id FROM shops WHERE slug=${slug} LIMIT 1`;
      if(!shops.length)return json(res,404,{error:'This shop link does not exist.'});
      const number='INK-'+Date.now().toString().slice(-7);
      const rows=await sql`INSERT INTO orders(shop_id,order_number,customer_name,customer_phone,service,details,amount,status,due_text,source) VALUES(${shops[0].id},${number},${customer},${phone},${service},${details},0,'pending','To schedule','customer-link') RETURNING order_number`;
      return json(res,201,{ok:true,orderNumber:rows[0].order_number});
    }

    const ownerKey=clean(req.headers['x-owner-key']);
    if(!ownerKey)return json(res,401,{error:'Owner access required'});
    const shops=await sql`SELECT id,slug FROM shops WHERE owner_key=${ownerKey} LIMIT 1`;
    if(!shops.length)return json(res,401,{error:'Shop access not found'});
    const shop=shops[0];

    if(req.method==='POST'&&body.action==='manual-order'){
      const customer=clean(body.customer),service=clean(body.service),details=clean(body.details),due=clean(body.due)||'To schedule',amount=Number(body.amount)||0;
      if(!customer||!service)return json(res,400,{error:'Customer and service are required.'});
      const number='INK-'+Date.now().toString().slice(-7);
      await sql`INSERT INTO orders(shop_id,order_number,customer_name,service,details,amount,status,due_text,source) VALUES(${shop.id},${number},${customer},${service},${details},${amount},'pending',${due},'manual')`;
      return json(res,201,{ok:true,orderNumber:number});
    }

    if(req.method==='PATCH'&&body.action==='status'){
      const status=['pending','design','printing','ready'].includes(body.status)?body.status:'pending';
      await sql`UPDATE orders SET status=${status} WHERE shop_id=${shop.id} AND order_number=${clean(body.orderNumber)}`;
      return json(res,200,{ok:true});
    }

    if(req.method==='PATCH'&&body.action==='slug'){
      const slug=cleanSlug(body.slug);
      if(slug.length<3)return json(res,400,{error:'Use at least 3 letters or numbers.'});
      const taken=await sql`SELECT 1 FROM shops WHERE slug=${slug} AND id<>${shop.id} LIMIT 1`;
      if(taken.length)return json(res,409,{error:'That shop URL is already taken.'});
      await sql`UPDATE shops SET slug=${slug} WHERE id=${shop.id}`;
      return json(res,200,{ok:true,slug});
    }
    return json(res,405,{error:'Unsupported request'});
  }catch(error){console.error(error);return json(res,500,{error:'Unable to complete the request.'})}
}
