import social from '../social.js';
export default async function handler(req,res){req.body={action:'vote',post_id:req.body?.aphorismId,vote:req.body?.vote};return social(req,res);}
