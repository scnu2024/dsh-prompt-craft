import {test,expect} from '@playwright/test'
const panel=page=>page.locator('[data-panel="prompt-craft"]')
const run=async page=>{await page.locator('.pc-btn-root').click();await expect(panel(page)).toHaveAttribute('data-phase','ready')}
const holdNextImageRequest=async page=>page.evaluate(()=>{
  const fetch=window.fetch
  const gate=new Promise(resolve=>{window.releaseImageRequest=resolve})
  let held=false
  window.fetch=async(url,options)=>{
    if(!held&&String(url).endsWith('/enhance')){held=true;window.imageRequestPending=true;await gate}
    return fetch(url,options)
  }
})

test('images survive refinement, apply and undo without putting bytes in storage',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/?scenario=images&delay=10');const before=await page.locator('.lab-draft').inputValue()
  await run(page);await expect(page.locator('.pc-panel-meta')).toContainText('已参考 2 张图片')
  await page.getByRole('button',{name:'再具体一点',exact:true}).click();await expect(panel(page)).toHaveAttribute('data-phase','ready')
  const calls=await page.evaluate(()=>window.preview.calls.filter(x=>x.url.endsWith('/enhance')).map(x=>x.body))
  expect(calls).toHaveLength(2);expect(calls.every(x=>x.images.length===2)).toBe(true)
  expect(calls[0].images.map(x=>x.name)).toEqual(['sample.png','sample.png'])
  const cached=await page.evaluate(()=>Object.values(sessionStorage).join(''));expect(cached).not.toContain(calls[0].images[0].data)
  await page.getByRole('button',{name:'应用结果',exact:true}).click();await expect(page.locator('.lab-chip')).toHaveCount(2)
  await expect(panel(page)).toHaveCount(0)
  await page.evaluate(()=>window.preview.undo());await expect(page.locator('.lab-draft')).toHaveValue(before);await expect(page.locator('.lab-chip')).toHaveCount(2)
  expect(errors).toEqual([])
})
test('image-only input supports questions, continue and further image requests',async({page})=>{
  await page.goto('/?scenario=image-only&delay=10');await expect(page.locator('.lab-draft')).toHaveValue('')
  await run(page);await expect(panel(page)).toHaveAttribute('data-status','needs_input')
  await page.getByRole('button',{name:'按已有信息继续',exact:true}).click();await expect(panel(page)).toHaveAttribute('data-status','ready')
  expect(await page.evaluate(()=>window.preview.calls.filter(x=>x.url.endsWith('/enhance')).every(x=>x.body.images.length===2))).toBe(true)
  await page.getByRole('button',{name:'应用结果',exact:true}).click();await expect(page.locator('.lab-draft')).not.toHaveValue('');await expect(page.locator('.lab-chip')).toHaveCount(2)
  await expect(panel(page)).toHaveCount(0)
})
test('image reorder while generating rejects the late preview',async({page})=>{
  await page.goto('/?scenario=images&delay=10');await holdNextImageRequest(page);await page.locator('.pc-btn-root').click()
  await expect.poll(()=>page.evaluate(()=>window.imageRequestPending)).toBe(true)
  await expect(panel(page)).toHaveAttribute('data-phase','running');await page.evaluate(()=>{window.preview.reorderImages();window.releaseImageRequest()})
  await expect(panel(page)).toHaveAttribute('data-phase','error');await expect(panel(page)).toContainText('草稿或图片已变化')
  await expect(page.getByRole('button',{name:'应用结果',exact:true})).toHaveCount(0)
})
test('refresh restores preview and rereads current browser image files',async({page})=>{
  await page.goto('/?scenario=images&delay=10');await run(page);await page.reload()
  await expect(panel(page)).toHaveAttribute('data-phase','ready')
  await page.getByRole('button',{name:'再具体一点',exact:true}).click();await expect(panel(page)).toHaveAttribute('data-phase','ready')
  expect(await page.evaluate(()=>window.preview.calls.filter(x=>x.url.endsWith('/enhance')).at(-1).body.images.length)).toBe(2)
})
test('cancelled image refinement retains the prior preview across conversations',async({page})=>{
  await page.goto('/?scenario=images&delay=10');await run(page)
  const candidate=await page.locator('.pc-card-text').last().textContent()
  await holdNextImageRequest(page);await page.getByRole('button',{name:'再具体一点',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.imageRequestPending)).toBe(true)
  await page.evaluate(()=>window.preview.switchSession('image-other'));await expect(panel(page)).toHaveCount(0)
  await page.evaluate(()=>window.preview.switchSession('preview-a'));await expect(panel(page)).toHaveAttribute('data-phase','running')
  await page.getByRole('button',{name:'取消',exact:true}).first().click();await expect(panel(page)).toHaveAttribute('data-phase','ready')
  await page.evaluate(()=>window.releaseImageRequest())
  expect(await page.locator('.pc-card-text').last().textContent()).toBe(candidate)
})
