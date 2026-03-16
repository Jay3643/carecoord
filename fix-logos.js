const fs = require('fs');
let f = fs.readFileSync('client/src/components/AppLauncher.jsx', 'utf8');

// Replace all image URLs with Google's favicon service which always works
// Format: https://www.google.com/s2/favicons?domain=DOMAIN&sz=64
const replacements = [
  ["{ name: 'Search', url: 'https://google.com', img: 'https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png' }", "{ name: 'Search', url: 'https://google.com', img: 'https://www.google.com/s2/favicons?domain=google.com&sz=128' }"],
  ["{ name: 'Gmail', url: 'https://mail.google.com', img: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' }", "{ name: 'Gmail', url: 'https://mail.google.com', img: 'https://www.google.com/s2/favicons?domain=mail.google.com&sz=128' }"],
  ["{ name: 'Calendar', url: 'https://calendar.google.com', img: 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31.ico' }", "{ name: 'Calendar', url: 'https://calendar.google.com', img: 'https://www.google.com/s2/favicons?domain=calendar.google.com&sz=128' }"],
  ["{ name: 'Drive', url: 'https://drive.google.com', img: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png' }", "{ name: 'Drive', url: 'https://drive.google.com', img: 'https://www.google.com/s2/favicons?domain=drive.google.com&sz=128' }"],
  ["{ name: 'Docs', url: 'https://docs.google.com', img: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico' }", "{ name: 'Docs', url: 'https://docs.google.com', img: 'https://www.google.com/s2/favicons?domain=docs.google.com&sz=128' }"],
  ["{ name: 'Sheets', url: 'https://sheets.google.com', img: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico' }", "{ name: 'Sheets', url: 'https://sheets.google.com', img: 'https://www.google.com/s2/favicons?domain=sheets.google.com&sz=128' }"],
  ["{ name: 'Slides', url: 'https://slides.google.com', img: 'https://ssl.gstatic.com/docs/presentations/images/favicon5.ico' }", "{ name: 'Slides', url: 'https://slides.google.com', img: 'https://www.google.com/s2/favicons?domain=slides.google.com&sz=128' }"],
  ["{ name: 'Meet', url: 'https://meet.google.com', img: 'https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v1/web-24dp/logo_meet_2020q4_color_1x_web_24dp.png' }", "{ name: 'Meet', url: 'https://meet.google.com', img: 'https://www.google.com/s2/favicons?domain=meet.google.com&sz=128' }"],
  ["{ name: 'Chat', url: 'https://chat.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/chat_2020q4_48dp.png' }", "{ name: 'Chat', url: 'https://chat.google.com', img: 'https://www.google.com/s2/favicons?domain=chat.google.com&sz=128' }"],
  ["{ name: 'Contacts', url: 'https://contacts.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png' }", "{ name: 'Contacts', url: 'https://contacts.google.com', img: 'https://www.google.com/s2/favicons?domain=contacts.google.com&sz=128' }"],
  ["{ name: 'Forms', url: 'https://forms.google.com', img: 'https://ssl.gstatic.com/docs/spreadsheets/forms/favicon_qp2.png' }", "{ name: 'Forms', url: 'https://forms.google.com', img: 'https://www.google.com/s2/favicons?domain=forms.google.com&sz=128' }"],
  ["{ name: 'Keep', url: 'https://keep.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/keep_2020q4_48dp.png' }", "{ name: 'Keep', url: 'https://keep.google.com', img: 'https://www.google.com/s2/favicons?domain=keep.google.com&sz=128' }"],
  ["{ name: 'Sites', url: 'https://sites.google.com', img: 'https://ssl.gstatic.com/atari/images/public/favicon.ico' }", "{ name: 'Sites', url: 'https://sites.google.com', img: 'https://www.google.com/s2/favicons?domain=sites.google.com&sz=128' }"],
  ["{ name: 'Groups', url: 'https://groups.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/groups_2020q4_48dp.png' }", "{ name: 'Groups', url: 'https://groups.google.com', img: 'https://www.google.com/s2/favicons?domain=groups.google.com&sz=128' }"],
  ["{ name: 'Admin', url: 'https://admin.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/admin_2020q4_48dp.png' }", "{ name: 'Admin', url: 'https://admin.google.com', img: 'https://www.google.com/s2/favicons?domain=admin.google.com&sz=128' }"],
  ["{ name: 'Maps', url: 'https://maps.google.com', img: 'https://maps.gstatic.com/mapfiles/maps_lite/images/2x/circle.png' }", "{ name: 'Maps', url: 'https://maps.google.com', img: 'https://www.google.com/s2/favicons?domain=maps.google.com&sz=128' }"],
  ["{ name: 'YouTube', url: 'https://youtube.com', img: 'https://www.youtube.com/s/desktop/271dfaef/img/favicon_48x48.png' }", "{ name: 'YouTube', url: 'https://youtube.com', img: 'https://www.google.com/s2/favicons?domain=youtube.com&sz=128' }"],
  ["{ name: 'Photos', url: 'https://photos.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/photos_2020q4_48dp.png' }", "{ name: 'Photos', url: 'https://photos.google.com', img: 'https://www.google.com/s2/favicons?domain=photos.google.com&sz=128' }"],
];

for (const [old, nw] of replacements) {
  f = f.replace(old, nw);
}

fs.writeFileSync('client/src/components/AppLauncher.jsx', f, 'utf8');
console.log('✓ All 18 app logos using Google favicon service (sz=128, crisp)');
console.log('Refresh browser.');
