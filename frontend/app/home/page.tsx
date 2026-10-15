'use client';
import {useWebsiteContent,websiteText} from '../../components/WebsiteContent';
import {coursePrice} from '../../lib/money';
import AcademyImage from '../../components/AcademyImage';
import {COURSE_CARD_SIZES} from '../../lib/imageSources';
import Link from 'next/link';
import {usePublicResource} from '../../lib/usePublicResource';
import {useMembershipAccess} from '../../lib/useMembershipAccess';
import ApiLoadError from '../../components/ApiLoadError';
import {useEffect,useMemo,useState} from 'react';
import {apiFetch} from '../../lib/api';
import {useAuth} from '../../components/auth/AuthProvider';
import SiteHeader from '../../components/SiteHeader';
import SiteFooter from '../../components/layout/SiteFooter';

export default function Home(){
 const website=useWebsiteContent();
 const {user,ready}=useAuth();
 const {data:courses,loading,error,retry}=usePublicResource('/courses','courses');
 const membership=useMembershipAccess();
 const decorated=useMemo(()=>courses.map(c=>({...c,membershipCovered:membership.active})),[courses,membership.active]);
 const courseLabel=(course:any)=>course.membershipCovered?'Membership Access':coursePrice(course);
 const courseNote=(course:any)=>course.membershipCovered?'Included in your active Academy membership':course.estimatedWeeks?`${course.estimatedWeeks} weeks`:course.durationMinutes?`${course.durationMinutes} minutes`:'Self-paced learning';
 return <main><SiteHeader/><section className="storeHero"><div><span className="kicker">{websiteText(website,'home-001','SINGH ACADEMY COURSES')}</span><h1>{websiteText(website,'home-002','Learn practical skills for conversations that matter.')}</h1><p>{websiteText(website,'home-003','Browse professional courses, choose your access plan, enroll securely and start lessons inside the same Singh Academy website.')}</p><a className="button" href="#course-store">{websiteText(website,'home-004','Browse Courses →')}</a></div><div className="storeHeroImages"><AcademyImage priority sizes="(max-width: 800px) 100vw, 50vw" src="/images/founder/dr-singh-office.webp" alt={websiteText(website,'home-005','Dr. Sukhsimranjit Singh')}/><AcademyImage src="/images/events/workshop-outdoor.jpg" alt={websiteText(website,'home-006','Singh Academy learning experience')}/></div></section><section id="course-store" className="section"><div className="sectionHead"><div><span className="kicker">{websiteText(website,'home-007','COURSE CATALOG')}</span><h2>{websiteText(website,'home-008','Choose your next course.')}</h2></div><p>{websiteText(website,'home-009','Each program includes structured modules, lessons, video learning, downloadable resources and progress tracking.')}</p></div><div className="courseVisualGrid">{loading&&<p role="status">{websiteText(website,'home-010','Loading published courses…')}</p>}{error&&<ApiLoadError message={error} onRetry={retry}/>}{!loading&&!error&&!decorated.length&&<p>{websiteText(website,'home-011','No courses have been published yet.')}</p>}{decorated.map((c,index)=><article className="courseVisualCard" key={c.slug}><AcademyImage sizes={COURSE_CARD_SIZES} priority={index<3} src={c.thumbnail||'/images/courses/cross-cultural-community.png'} alt={c.title} style={{objectFit:c.thumbnailFit||'cover',objectPosition:`${c.thumbnailPositionX??50}% ${c.thumbnailPositionY??50}%`}}/><div className="courseCardBody"><span className="instructorBadge">{c.instructor||'Singh Academy Faculty'}</span><h3>{c.title}</h3><p>{c.shortDescription||c.description}</p><div className="courseMeta"><b>{courseLabel(c)}</b><span>{courseNote(c)}</span></div><Link prefetch={false} className="button courseEnroll" href={`/courses/${c.slug}`}>{websiteText(website,'home-012','View Course →')}</Link></div></article>)}</div></section><section className="eventShowcase"><div><span className="kicker gold">{websiteText(website,'home-013','LEARNING IN PRACTICE')}</span><h2>{websiteText(website,'home-014','Courses shaped by real conversations, global events and professional experience.')}</h2><p>{websiteText(website,'home-015','Real Singh Academy workshops and global learning experiences connect course concepts with professional practice.')}</p></div><div className="eventMosaic"><AcademyImage src="/images/events/rising-tide-group.jpg" alt={websiteText(website,'home-016','Singh Academy global event')}/><AcademyImage src="/images/events/global-event.jpg" alt={websiteText(website,'home-017','International academy event')}/><AcademyImage src="/images/events/academy-workshop.jpg" alt={websiteText(website,'home-018','Professional learning workshop')}/></div></section><SiteFooter/></main>;
}
