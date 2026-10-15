import {teamCategories,compareTeam} from '../utils/teamCategories.js';
import Course from '../models/Course.js';
import TeamMember from '../models/TeamMember.js';
import Review from '../models/Review.js';
import {catalogCache} from './catalogCache.js';
import {mediaUrl} from '../utils/media.js';
/** Public landing summaries only. Never expose lessons, answers, user IDs or billing. */
export async function landingContent(req){
 const [courses,team,reviews]=await Promise.all([
  catalogCache.get('landing:courses',()=>Course.find({published:true}).select('title slug thumbnail thumbnailFileId thumbnailFit thumbnailPositionX thumbnailPositionY thumbnailZoom instructor shortDescription description level estimatedWeeks price salePrice accessType pricing featured').sort({featured:-1,createdAt:-1}).limit(24).lean()),
  catalogCache.get('landing:team',()=>TeamMember.find({active:true}).select('name title role category categories order image imageFileId imageFit imagePositionX imagePositionY imageZoom affiliation bio').sort({order:1,name:1}).limit(60).lean()),
  catalogCache.get('landing:reviews',()=>Review.find({status:'approved'}).select('name rating message createdAt updatedAt').sort({updatedAt:-1,createdAt:-1}).limit(20).lean())
 ]);
 const pick=(item,keys)=>Object.fromEntries(keys.split(' ').filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
 const courseKeys='_id title slug thumbnailFit thumbnailPositionX thumbnailPositionY thumbnailZoom instructor shortDescription description level estimatedWeeks price salePrice accessType pricing featured';
 const teamKeys='_id name title role category categories order imageFit imagePositionX imagePositionY imageZoom affiliation bio';
 return {courses:courses.map(c=>({...pick(c,courseKeys),thumbnail:mediaUrl(req,c.thumbnailFileId,c.thumbnail)})),team:team.slice().sort(compareTeam).map(m=>({...pick(m,teamKeys),categories:teamCategories(m),image:mediaUrl(req,m.imageFileId,m.image)})),reviews:reviews.map(x=>pick(x,'_id name rating message createdAt updatedAt'))};
}
