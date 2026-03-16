const {initDb,getDb,saveDb}=require('./database');
initDb().then(()=>{
  const db=getDb();
  const emails = ['hello@seniorityhealthcare.com','test@seniorityhealthcare.com'];
  for (const email of emails) {
    const user = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (user) {
      db.prepare('DELETE FROM user_regions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM users WHERE id=?').run(user.id);
      console.log('Deleted user:', email);
    }
    db.prepare('DELETE FROM invitations WHERE email=?').run(email);
    console.log('Deleted invitations for:', email);
  }
  saveDb();
  console.log('Done');
});
