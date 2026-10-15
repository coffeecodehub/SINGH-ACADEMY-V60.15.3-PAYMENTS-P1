/** Labels only. Backend authorization/price checks remain authoritative. */
export function courseAccessPresentation(course:{accessType?:string},membershipActive=false){
 if(course.accessType==='free')return {free:true,title:'Free Course',description:'This course is free. Start learning with your student account; no purchase is needed.',button:'Start Course →',busy:'Starting course…',note:'Your enrollment and learning progress are saved to your own account.'};
 if(membershipActive)return {free:false,title:'Membership Access',description:'Included in your active Academy membership. Open the course to begin learning.',button:'Open Course →',busy:'Opening course…',note:'Included in your active Academy membership.'};
 return {free:false,title:'Choose how you want to access this course.',description:'Purchase this course individually, or use an active Academy membership to unlock the complete course library.',button:'Open / Purchase Course →',busy:'Opening course…',note:'Already enrolled or covered by membership? The course opens directly.'};
}
