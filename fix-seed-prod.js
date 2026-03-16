const fs = require('fs');
let seed = fs.readFileSync('server/seed.js', 'utf8');

// Replace the demo users with actual users including DrHopkins
seed = seed.replace(
  `[
    {id:'u1',name:'Sarah Mitchell',email:'smitchell@carecoord.org',role:'coordinator',avatar:'SM',rg:['r1','r4']},
    {id:'u2',name:'James Rivera',email:'jrivera@carecoord.org',role:'coordinator',avatar:'JR',rg:['r1']},
    {id:'u3',name:'Angela Chen',email:'achen@carecoord.org',role:'coordinator',avatar:'AC',rg:['r2']},
    {id:'u4',name:'Marcus Brown',email:'mbrown@carecoord.org',role:'coordinator',avatar:'MB',rg:['r2','r4']},
    {id:'u5',name:'Lisa Nowak',email:'lnowak@carecoord.org',role:'coordinator',avatar:'LN',rg:['r3']},
    {id:'u6',name:'Dr. Patricia Hayes',email:'phayes@carecoord.org',role:'supervisor',avatar:'PH',rg:['r1','r2','r3','r4']},
    {id:'u7',name:'Tom Adkins',email:'tadkins@carecoord.org',role:'admin',avatar:'TA',rg:['r1','r2','r3','r4']},
  ]`,
  `[
    {id:'u1',name:'Dr. Hopkins',email:'drhopkins@seniorityhealthcare.com',role:'admin',avatar:'DH',rg:['r1','r2','r3','r4']},
    {id:'u2',name:'Hello Coordinator',email:'hello@seniorityhealthcare.com',role:'coordinator',avatar:'HC',rg:['r1','r2','r3','r4']},
    {id:'u3',name:'Sarah Mitchell',email:'smitchell@carecoord.org',role:'coordinator',avatar:'SM',rg:['r1','r4']},
    {id:'u4',name:'James Rivera',email:'jrivera@carecoord.org',role:'coordinator',avatar:'JR',rg:['r1']},
    {id:'u5',name:'Angela Chen',email:'achen@carecoord.org',role:'coordinator',avatar:'AC',rg:['r2']},
    {id:'u6',name:'Dr. Patricia Hayes',email:'phayes@carecoord.org',role:'supervisor',avatar:'PH',rg:['r1','r2','r3','r4']},
    {id:'u7',name:'Tom Adkins',email:'tadkins@carecoord.org',role:'admin',avatar:'TA',rg:['r1','r2','r3','r4']},
  ]`
);

// Replace regions with actual ones
seed = seed.replace(
  `[['r1','Central PA','["centralpa@carecoord.org"]',1],['r2','Western PA','["westernpa@carecoord.org"]',1],['r3','Eastern PA','["easternpa@carecoord.org"]',1],['r4','Triage / Unrouted','[]',1]]`,
  `[['r1','Central PA','["centralpa@seniorityhealthcare.com"]',1],['r2','South NJ','["southnj@seniorityhealthcare.com"]',1],['r3','Delaware Valley','["delawarevalley@seniorityhealthcare.com"]',1],['r4','Triage / Unrouted','[]',1]]`
);

fs.writeFileSync('server/seed.js', seed, 'utf8');
console.log('✓ seed.js updated with DrHopkins admin + hello@ coordinator + actual regions');
console.log('Push and redeploy.');
