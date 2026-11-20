import {test,expect} from '@playwright/test';
for (const width of [375,1280]) {
 test(`active input and outage message ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const sent: Record<string,unknown>[]=[];
  const sentence="We couldn't reach the Cook County records service. Please try again shortly — this is on our side.";
  await page.route('**/api/free-check',async route=>{
   sent.push(route.request().postDataJSON());
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:sentence,code:'PROPERTY_LOOKUP_UNAVAILABLE',retryable:true})});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/I have my PIN instead/}).click();
  await page.getByPlaceholder('16-01-216-001-0000').fill('18062140010000');
  await page.getByRole('button',{name:/Look up by address instead/}).click();
  await page.getByPlaceholder('123 S Sample Ave, La Grange IL').last().fill('123 N Sample St');
  await page.getByRole('button',{name:/check my assessment/i}).click();
  await expect(page.getByRole('alert').filter({hasText:sentence})).toHaveText(sentence);
  expect(sent[0]).toMatchObject({mode:'address',address:'123 N Sample St'});
  expect(sent[0]).not.toHaveProperty('pin');
  await page.getByRole('button',{name:/I have my PIN instead/}).click();
  await page.getByRole('button',{name:/check my assessment/i}).click();
  await expect.poll(()=>sent.length).toBe(2);
  expect(sent[1]).toMatchObject({mode:'pin'});
  expect(sent[1]).not.toHaveProperty('address');
  expect(sent[1]).not.toHaveProperty('selectedPin');
 });
}
