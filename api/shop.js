import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
const json=(res,status,data)=>{res.status(status).setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify(data))};
const cleanSlug=v=>String(v||'').toLowerCase().trim().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
const clean=(v,n=500)=>String(v||'').trim().slice(0,n);
const price=v=>Math.max(0,Number(v)||0);
const token=()=>crypto.randomBytes(24).toString('hex');
const tokenHash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
async function ensureGuestAccess(sql){await sql`CREATE TABLE IF NOT EXISTS customer_access_tokens (id BIGSERIAL PRIMARY KEY, shop_id BIGINT NOT NULL, customer_id BIGINT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), last_used_at TIMESTAMPTZ DEFAULT NOW())`;await sql`CREATE INDEX IF NOT EXISTS idx_customer_access_shop_customer ON customer_access_tokens(shop_id,customer_id)`}
export default async function handler(req,res){
 if(!process.env.DATABASE_URL)return json(res,503,{error:'Database is not connected yet.'});
 const sql=neon(process.env.DATABASE_URL);
 try{
  if(req.method==='GET'){
   const slug=cleanSlug(req.query.slug),ownerKey=clean(req.headers['x-owner-key']);
   if(ownerKey){
    const shops=await sql`SELECT id,slug,business_name,owner_name,theme,dashboard_config FROM shops WHERE owner_key=${ownerKey} LIMIT 1`;
    if(!shops.length)return json(res,404,{error:'Shop not found'}); const shop=shops[0];
    const [orders,services,customers,files]=await Promise.all([
     sql`SELECT id,order_number,customer_id,customer_name,customer_phone,service,details,amount,status,due_text,source,created_at FROM orders WHERE shop_id=${shop.id} ORDER BY created_at DESC`,
     sql`SELECT id,name,description,pricing_type,price,unit_label,active FROM services WHERE shop_id=${shop.id} ORDER BY active DESC,name`,
     sql`SELECT c.id,c.name,c.phone,c.notes,c.created_at,COUNT(o.id)::int AS order_count,COALESCE(SUM(o.amount),0)::numeric AS total_value FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE c.shop_id=${shop.id} GROUP BY c.id ORDER BY c.name`,
     sql`SELECT f.id,f.order_id,f.file_name,f.mime_type,f.file_size FROM order_files f WHERE f.shop_id=${shop.id} ORDER BY f.id`
    ]);
    const byOrder=new Map();for(const f of files){const k=String(f.order_id);if(!byOrder.has(k))byOrder.set(k,[]);byOrder.get(k).push({id:f.id,file_name:f.file_name,mime_type:f.mime_type,file_size:f.file_size})}for(const o of orders)o.files=byOrder.get(String(o.id))||[];
    return json(res,200,{shop,orders,services,customers});
   }
   if(!slug)return json(res,400,{error:'Shop URL is required'});
   const shops=await sql`SELECT id,slug,business_name,theme FROM shops WHERE slug=${slug} LIMIT 1`;
   if(!shops.length)return json(res,404,{error:'This shop link does not exist.'}); const shop=shops[0];
   const access=clean(req.query.access,128);
   if(access){await ensureGuestAccess(sql);const rows=await sql`SELECT customer_id FROM customer_access_tokens WHERE shop_id=${shop.id} AND token_hash=${tokenHash(access)} LIMIT 1`;if(!rows.length)return json(res,403,{error:'This private order-history key is invalid.'});await sql`UPDATE customer_access_tokens SET last_used_at=NOW() WHERE token_hash=${tokenHash(access)}`;const orders=await sql`SELECT order_number,service,details,amount,status,due_text,created_at FROM orders WHERE shop_id=${shop.id} AND customer_id=${rows[0].customer_id} ORDER BY created_at DESC`;return json(res,200,{shop:{slug:shop.slug,business_name:shop.business_name,theme:shop.theme},orders})}
   const services=await sql`SELECT id,name,description,pricing_type,price,unit_label FROM services WHERE shop_id=${shop.id} AND active=TRUE ORDER BY name`;
   return json(res,200,{shop:{slug:shop.slug,business_name:shop.business_name,theme:shop.theme},services});
  }
  const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  if(req.method==='POST'&&body.action==='register'){
   const slug=cleanSlug(body.slug),business=clean(body.business),owner=clean(body.ownerName),ownerKey=clean(body.ownerKey);
   if(!slug||!business||!owner||ownerKey.length<20)return json(res,400,{error:'Missing shop registration details'});
   const exists=await sql`SELECT 1 FROM shops WHERE slug=${slug} AND owner_key<>${ownerKey} LIMIT 1`; if(exists.length)return json(res,409,{error:'That shop URL is already taken.'});
   const rows=await sql`INSERT INTO shops(slug,business_name,owner_name,owner_key) VALUES(${slug},${business},${owner},${ownerKey}) ON CONFLICT(owner_key) DO UPDATE SET business_name=EXCLUDED.business_name,owner_name=EXCLUDED.owner_name RETURNING slug,business_name,owner_name`;
   return json(res,201,{shop:rows[0]});
  }
  if(req.method==='POST'&&body.action==='public-order'){
   const slug=cleanSlug(body.slug),customer=clean(body.customer),phone=clean(body.phone),service=clean(body.service),details=clean(body.details,2000);
   if(!slug||!customer||!service)return json(res,400,{error:'Your name and print job are required.'});
   const shops=await sql`SELECT id FROM shops WHERE slug=${slug} LIMIT 1`; if(!shops.length)return json(res,404,{error:'This shop link does not exist.'}); const shopId=shops[0].id;
   const access=clean(body.access,128);let customerId=null;
   if(access){await ensureGuestAccess(sql);const a=await sql`SELECT customer_id FROM customer_access_tokens WHERE shop_id=${shopId} AND token_hash=${tokenHash(access)} LIMIT 1`;if(a.length)customerId=a[0].customer_id}
   if(!customerId){let customers=phone?await sql`SELECT id FROM customers WHERE shop_id=${shopId} AND phone=${phone} ORDER BY created_at LIMIT 1`:[];if(!customers.length)customers=await sql`SELECT id FROM customers WHERE shop_id=${shopId} AND lower(name)=lower(${customer}) ORDER BY created_at LIMIT 1`;if(customers.length)customerId=customers[0].id;else{const c=await sql`INSERT INTO customers(shop_id,name,phone) VALUES(${shopId},${customer},NULLIF(${phone},'')) RETURNING id`;customerId=c[0].id}}
   if(phone)await sql`UPDATE customers SET phone=COALESCE(NULLIF(${phone},''),phone),updated_at=NOW() WHERE id=${customerId}`;
   const svc=await sql`SELECT name,price,pricing_type,unit_label FROM services WHERE shop_id=${shopId} AND id::text=${clean(body.serviceId)} AND active=TRUE LIMIT 1`;
   const serviceName=svc.length?svc[0].name:service,q=Math.max(1,Number(body.quantity)||1);let amount=0;if(svc.length){const p=price(svc[0].price),type=svc[0].pricing_type,unit=String(svc[0].unit_label||'').toLowerCase();amount=(['per_item','per_page'].includes(type)||['item','items','page','pages','pc','pcs','piece','pieces'].includes(unit))?p*q:type==='fixed'?p:0}
   const number='INK-'+Date.now().toString().slice(-7);
   await sql`INSERT INTO orders(shop_id,customer_id,order_number,customer_name,customer_phone,service,details,amount,status,due_text,source) VALUES(${shopId},${customerId},${number},${customer},${phone},${serviceName},${details},${amount},'pending','To schedule','customer-link')`;
   await ensureGuestAccess(sql);let raw=access;if(!raw){raw=token();await sql`INSERT INTO customer_access_tokens(shop_id,customer_id,token_hash) VALUES(${shopId},${customerId},${tokenHash(raw)})`}
   return json(res,201,{ok:true,orderNumber:number,amount,access:raw});
  }
  const ownerKey=clean(req.headers['x-owner-key']);if(!ownerKey)return json(res,401,{error:'Owner access required'});
  const shops=await sql`SELECT id,slug FROM shops WHERE owner_key=${ownerKey} LIMIT 1`;if(!shops.length)return json(res,401,{error:'Shop access not found'});const shop=shops[0];
  if(req.method==='POST'&&body.action==='service'){const name=clean(body.name),pricingType=['fixed','per_item','per_page','per_sqft','custom'].includes(body.pricingType)?body.pricingType:'fixed',unit=clean(body.unit)||'item';if(!name)return json(res,400,{error:'Service name is required.'});await sql`INSERT INTO services(shop_id,name,description,pricing_type,price,unit_label,active) VALUES(${shop.id},${name},${clean(body.description)},${pricingType},${price(body.price)},${unit},TRUE) ON CONFLICT(shop_id,name) DO UPDATE SET description=EXCLUDED.description,pricing_type=EXCLUDED.pricing_type,price=EXCLUDED.price,unit_label=EXCLUDED.unit_label,active=TRUE,updated_at=NOW()`;return json(res,201,{ok:true})}
  if(req.method==='PATCH'&&body.action==='service'){await sql`UPDATE services SET name=${clean(body.name)},description=${clean(body.description)},pricing_type=${body.pricingType},price=${price(body.price)},unit_label=${clean(body.unit)||'item'},active=${body.active!==false},updated_at=NOW() WHERE id::text=${clean(body.id)} AND shop_id=${shop.id}`;return json(res,200,{ok:true})}
  if(req.method==='DELETE'&&body.action==='service'){await sql`DELETE FROM services WHERE id::text=${clean(body.id)} AND shop_id=${shop.id}`;return json(res,200,{ok:true})}
  if(req.method==='POST'&&body.action==='customer'){const name=clean(body.name);if(!name)return json(res,400,{error:'Customer name is required.'});await sql`INSERT INTO customers(shop_id,name,phone,notes) VALUES(${shop.id},${name},NULLIF(${clean(body.phone)},''),NULLIF(${clean(body.notes)},''))`;return json(res,201,{ok:true})}
  if(req.method==='PATCH'&&body.action==='customer'){await sql`UPDATE customers SET name=${clean(body.name)},phone=NULLIF(${clean(body.phone)},''),notes=NULLIF(${clean(body.notes)},''),updated_at=NOW() WHERE id::text=${clean(body.id)} AND shop_id=${shop.id}`;return json(res,200,{ok:true})}
  if(req.method==='DELETE'&&body.action==='customer'){await sql`DELETE FROM customers WHERE id::text=${clean(body.id)} AND shop_id=${shop.id}`;return json(res,200,{ok:true})}
  if(req.method==='POST'&&body.action==='manual-order'){const customer=clean(body.customer),service=clean(body.service),details=clean(body.details),due=clean(body.due)||'To schedule',amount=price(body.amount);if(!customer||!service)return json(res,400,{error:'Customer and service are required.'});let c=await sql`SELECT id FROM customers WHERE shop_id=${shop.id} AND lower(name)=lower(${customer}) LIMIT 1`;let cid;if(c.length)cid=c[0].id;else{c=await sql`INSERT INTO customers(shop_id,name) VALUES(${shop.id},${customer}) RETURNING id`;cid=c[0].id}const number='INK-'+Date.now().toString().slice(-7);await sql`INSERT INTO orders(shop_id,customer_id,order_number,customer_name,service,details,amount,status,due_text,source) VALUES(${shop.id},${cid},${number},${customer},${service},${details},${amount},'pending',${due},'manual')`;return json(res,201,{ok:true,orderNumber:number})}
  if(req.method==='PATCH'&&body.action==='status'){const status=['pending','design','printing','ready'].includes(body.status)?body.status:'pending';await sql`UPDATE orders SET status=${status} WHERE shop_id=${shop.id} AND order_number=${clean(body.orderNumber)}`;return json(res,200,{ok:true})}
  if(req.method==='PATCH'&&body.action==='slug'){const slug=cleanSlug(body.slug);if(slug.length<3)return json(res,400,{error:'Use at least 3 letters or numbers.'});const taken=await sql`SELECT 1 FROM shops WHERE slug=${slug} AND id<>${shop.id} LIMIT 1`;if(taken.length)return json(res,409,{error:'That shop URL is already taken.'});await sql`UPDATE shops SET slug=${slug} WHERE id=${shop.id}`;return json(res,200,{ok:true,slug})}
  if(req.method==='PATCH'&&body.action==='settings'){const theme=['burgundy','ocean','forest','charcoal','violet'].includes(body.theme)?body.theme:'burgundy';const config=JSON.stringify(body.dashboardConfig||{});await sql`UPDATE shops SET theme=${theme},dashboard_config=${config}::jsonb WHERE id=${shop.id}`;return json(res,200,{ok:true,theme,dashboardConfig:body.dashboardConfig||{}})}
  return json(res,405,{error:'Unsupported request'});
 }catch(error){console.error(error);return json(res,500,{error:'Unable to complete the request.'})}
}