import { get } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';
const clean=(v,n=255)=>String(v||'').trim().slice(0,n);
const json=(res,status,data)=>{res.status(status).setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify(data))};
export default async function handler(req,res){
 if(req.method!=='GET')return json(res,405,{error:'GET required'});
 if(!process.env.DATABASE_URL)return json(res,503,{error:'Database is not connected yet.'});
 try{
  const ownerKey=clean(req.headers['x-owner-key']),id=clean(req.query.id);
  if(!ownerKey||!id)return json(res,401,{error:'Owner access required'});
  const sql=neon(process.env.DATABASE_URL);
  const rows=await sql`SELECT f.file_url,f.file_name,f.mime_type FROM order_files f JOIN shops s ON s.id=f.shop_id WHERE f.id::text=${id} AND s.owner_key=${ownerKey} LIMIT 1`;
  if(!rows.length)return json(res,404,{error:'Artwork not found.'});
  const result=await get(rows[0].file_url,{access:'private'});
  if(!result?.stream)return json(res,404,{error:'Artwork is no longer available.'});
  res.status(200);res.setHeader('Content-Type',rows[0].mime_type||'application/octet-stream');res.setHeader('Content-Disposition',`inline; filename="${String(rows[0].file_name).replace(/["\r\n]/g,'')}"`);res.setHeader('Cache-Control','private, no-store');
  const reader=result.stream.getReader();while(true){const {done,value}=await reader.read();if(done)break;res.write(Buffer.from(value))}return res.end();
 }catch(error){console.error(error);return json(res,500,{error:'Unable to open artwork.'})}
}
