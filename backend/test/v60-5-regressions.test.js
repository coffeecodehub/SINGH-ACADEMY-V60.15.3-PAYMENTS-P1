import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('V60.6 client admin exposes individual course-purchase invoices',()=>{
 const routes=read('backend/src/routes/academyAdminRoutes.js');
 const portal=read('frontend/components/business/BusinessPortal.tsx');
 const component=read('frontend/components/business/AdminCoursePurchases.tsx');
 assert.match(routes,/r\.get\('\/purchases'/);
 assert.match(routes,/filter=\{kind:'course'\}/);
 assert.match(routes,/Invoice\.find\(filter\)/);
 assert.match(routes,/Payment\.find\(\{invoice:\{\$in:ids\},status:'paid'\}\)/);
 assert.match(routes,/Enrollment\.find\(\{invoice:\{\$in:ids\}\}\)/);
 assert.match(portal,/title:'Course purchases'/);
 assert.match(portal,/AdminCoursePurchases/);
 assert.match(component,/course-purchase invoices/i);
});

test('V60.6 active membership hides catalog pricing behind membership-access state',()=>{
 const routes=read('backend/src/routes/courseRoutes.js');
 const home=read('frontend/app/home/page.tsx');
 const courses=read('frontend/app/courses/page.tsx');
 assert.match(routes,/membershipActive:Boolean\(membership\)/);
 assert.match(routes,/membershipAccess:Boolean\(membership\)/);
 assert.match(home,/membershipCovered\?'Membership Access':coursePrice\(course\)/);
 assert.match(courses,/c\.membershipCovered\?'Membership Access':coursePrice\(c\)/);
 assert.match(home,/Included in your active Academy membership/);
 assert.match(courses,/Included in your active Academy membership/);
});

test('V60.6 keeps per-user My Courses semantics while membership exposes the published library',()=>{
 const routes=read('backend/src/routes/courseRoutes.js');
 const mine=routes.slice(routes.indexOf("r.get('/enrolled/mine'"),routes.indexOf("r.get('/:slug'"));
 assert.match(mine,/effectiveCourseEnrollments\(req\.user\._id/);
 assert.match(mine,/Course\.find\(membership\?\{published:true\}:\{published:true,slug:\{\$in:slugs\}\}\)/);
 assert.match(mine,/CourseCompletion\.find\(\{user:req\.user\._id/);
 assert.match(mine,/Progress\.find\(\{user:req\.user\.id/);
});

test('V60.6 certificate master uses the approved Singh Academy assets in the redesigned layout',()=>{
 const source=read('backend/src/services/certificatePdf.js');
 assert.match(source,/certificate-theme-v608\.rgb\.deflate/);
 assert.match(source,/certificate-theme-v608\.json/);
 assert.match(source,/\/ThemeArtwork/);
 assert.match(source,/Completion acknowledged and certificate issued by Singh Academy/);
 assert.match(source,/Authorized Signature - Singh Academy/);
 assert.match(source,/Certificate Service - /);
 const theme=JSON.parse(read('backend/src/assets/certificate-theme-v608.json'));
 assert.equal(theme.id,'singh-approved-gold-v608'); // Approved design identity is independent of release versions.
});

test('V60.6 package and health metadata are consistent',()=>{
 const version=JSON.parse(read('package.json')).version;
 assert.equal(JSON.parse(read('backend/package.json')).version,version);
 assert.equal(JSON.parse(read('frontend/package.json')).version,version);
 assert.ok(read('backend/src/app.js').includes(`version:'${version}'`));
 assert.ok(read('backend/src/server.js').includes(`Singh Academy V${version} API listening`));
 assert.ok(read('frontend/components/business/BusinessPortal.tsx').includes(`V${version}`));
});
