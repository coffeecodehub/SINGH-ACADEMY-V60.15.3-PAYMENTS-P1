'use client';
import {useEffect,useMemo,useState} from 'react';
import {useWebsiteContent,websiteText} from '../../components/WebsiteContent';
import {coursePrice} from '../../lib/money';
import AcademyImage from '../../components/AcademyImage';
import {COURSE_CARD_SIZES} from '../../lib/imageSources';
import Link from 'next/link';
import {usePublicResource} from '../../lib/usePublicResource';
import {useMembershipAccess} from '../../lib/useMembershipAccess';
import ApiLoadError from '../../components/ApiLoadError';
import {apiFetch} from '../../lib/api';
import {useAuth} from '../../components/auth/AuthProvider';
import SiteHeader from '../../components/SiteHeader';
import SiteFooter from '../../components/layout/SiteFooter';
import BackButton from '../../components/layout/BackButton';

const fallbackImage='/images/courses/cross-cultural-community.png';

export default function CoursesPage(){
 const website=useWebsiteContent();
 const {user,ready}=useAuth();
 const {data:courses,loading,error,retry}=usePublicResource('/courses','courses');
 const membership=useMembershipAccess();
 const decorated=useMemo(()=>courses.map(c=>({...c,membershipCovered:membership.active})),[courses,membership.active]);
 const accessLabel=(course:any)=>course.membershipCovered?'Membership access':course.accessType==='membership'?'Membership access':course.pricing?.[0]?.durationMonths?`${course.pricing[0].durationMonths} month${course.pricing[0].durationMonths===1?'':'s'} access`:`${course.accessMonths||1} month${(course.accessMonths||1)===1?'':'s'} access`;
 return <main><SiteHeader/><section className="innerHero"><BackButton label="Back"/><span className="kicker">{websiteText(website,'courses-001','COURSES')}</span><h1>{websiteText(website,'courses-002','Professional learning, organized around practical outcomes.')}</h1><p>{websiteText(website,'courses-003','Open a course to review curriculum, modules, lessons, resources, access period and enrollment options.')}</p></section><section className="contentWrap">{error&&<ApiLoadError message={error} onRetry={retry}/>} {loading?<div className="emptyState"><b>{websiteText(website,'courses-004','Loading courses…')}</b></div>:decorated.length?<div className="courseVisualGrid">{decorated.map((c,index)=><article className="courseVisualCard" key={c._id||c.slug}><AcademyImage sizes={COURSE_CARD_SIZES} priority={index<3} style={{objectFit:c.thumbnailFit||'cover',objectPosition:`${c.thumbnailPositionX??50}% ${c.thumbnailPositionY??50}%`,transform:`scale(${c.thumbnailZoom||1})`}} src={c.thumbnail||fallbackImage} onError={e=>{e.currentTarget.src=fallbackImage}} alt={c.title}/><div className="courseCardBody"><span className="instructorBadge">{c.instructor||'Singh Academy Faculty'}</span><h3>{c.title}</h3><p>{c.shortDescription||c.description||'Professional Singh Academy course.'}</p><div className="courseMeta"><b>{c.membershipCovered?'Membership Access':coursePrice(c)}</b><span>{c.membershipCovered?'Included in your active Academy membership':accessLabel(c)}</span></div><Link prefetch={false} className="button courseEnroll" href={`/courses/${c.slug}`}>{websiteText(website,'courses-005','View Course →')}</Link></div></article>)}</div>:error?null:<div className="emptyState"><b>{websiteText(website,'courses-006','Courses coming soon.')}</b><p>{websiteText(website,'courses-007','No published course data is available yet. Run the backend seed command or publish courses from the admin system.')}</p></div>}</section><SiteFooter/></main>;
}
