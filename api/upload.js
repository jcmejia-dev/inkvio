import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const json=(res,status,data)=>{res.status(status).setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify(data))};
const clean=(v,n=255)=>String(v||'').trim().slice(0,n);
const cleanSlug=v=>String(v||'').toLowerCase().trim().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
const safeName=v=>clean(v).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'artwork';
const tokenHash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');

export const config={api:{bodyParser:false}};

async function readBody(req,maxBytes=15*1024*1024){
 const chunks=[];let total=0;
 for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Object.assign(new Error('File is too large. Maximum size is 15 MB per file.'),{status:413});chunks.push(chunk)}
 return Buffer.concat(chunks);
}

export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'POST required'});
 if(!process.env.DATABASE_URL)return json(res,503,{error:'Database is not connected yet.'});
 try{
  const slug=cleanSlug(req.query.slug),orderNumber=clean(req.query.order),access=clean(req.headers['x-customer-access'],128),fileName=safeName(req.headers['x-file-name']),contentType=clean(req.headers['content-type'])||'application/octet-stream';
  if(!slug||!orderNumber||!access||!fileName)return json(res,400,{error:'Missing upload information.'});
  const sql=neon(process.env.DATABASE_URL);
  const rows=await sql`SELECT o.id AS order_id,o.shop_id FROM orders o JOIN shops s ON s.id=o.shop_id JOIN customer_access_tokens t ON t.shop_id=o.shop_id AND t.customer_id=o.customer_id WHERE s.slug=${slug} AND o.order_number=${orderNumber} AND t.token_hash=${tokenHash(access)} LIMIT 1`;
  if(!rows.length)return json(res,403,{error:'This order upload key is invalid.'});
  const body=await readBody(req);
  if(!body.length)return json(res,400,{error:'The selected file is empty.'});
  const path=`orders/${rows[0].shop_id}/${orderNumber}/${crypto.randomUUID()}-${fileName}`;
  const blob=await put(path,body,{access:'private',contentType,addRandomSuffix:false});
  const inserted=await sql`INSERT INTO order_files(order_id,shop_id,file_name,file_url,mime_type,file_size) VALUES(${rows[0].order_id},${rows[0].shop_id},${fileName},${blob.url},${contentType},${body.length}) RETURNING id,file_name,mime_type,file_size`;
  return json(res,201,{ok:true,file:inserted[0]});
 }catch(error){console.error(error);return json(res,error.status||500,{error:error.message||'Unable to upload artwork.'})}
}
