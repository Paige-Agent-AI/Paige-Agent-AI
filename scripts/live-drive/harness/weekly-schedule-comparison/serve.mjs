import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=path.resolve('work/weekly-comparison-native');
const files={'/bundle.js':['bundle.js','text/javascript'],'/bundle.css':['bundle.css','text/css']};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const [name,type]=files[url.pathname]??['index.html','text/html'];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(await fs.readFile(path.join(base,name)));}catch{res.writeHead(404);res.end();}}).listen(5195,'127.0.0.1',()=>console.log('Neutral EXP05 fixture http://127.0.0.1:5195'));
