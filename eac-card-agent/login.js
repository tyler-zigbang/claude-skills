// 최초 1회 실행: 브라우저가 뜨면 Google 계정으로 EAC에 로그인하세요.
// 로그인 세션은 ./profile 폴더에 저장되어 이후 자동 실행에 재사용됩니다.
const { launch, EAC_URL } = require('./lib/browser');

(async () => {
  const context = await launch({ headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(EAC_URL, { waitUntil: 'domcontentloaded' });

  console.log('브라우저에서 Google 로그인을 완료해주세요. (최대 10분 대기)');

  // eac.zigbang.in 도메인으로 돌아올 때까지 대기
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const url = page.url();
    if (url.startsWith('https://eac.zigbang.in') && !url.includes('oauth')) {
      console.log('로그인 성공! 세션이 저장되었습니다: ' + url);
      await page.waitForTimeout(3000); // 쿠키 저장 여유
      await context.close();
      process.exit(0);
    }
  }
  console.log('시간 초과: 로그인이 완료되지 않았습니다.');
  await context.close();
  process.exit(1);
})();
