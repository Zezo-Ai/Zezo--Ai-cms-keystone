import { type Browser, type Page } from 'playwright'
import { exampleProjectTests, initFirstItemTest, loadIndex } from './utils'

exampleProjectTests('../examples/auth', browserType => {
  let browser: Browser = undefined as any
  let page: Page = undefined as any
  beforeAll(async () => {
    browser = await browserType.launch()
    page = await browser.newPage()
    await loadIndex(page)
  })
  test('going to any page redirects to /init with a Cache-Control: no-cache, max-age=0 header', async () => {
    const res = await fetch('http://localhost:3000', { redirect: 'manual' })
    expect(res.status).toEqual(302)
    expect(res.headers.get('Location')).toEqual('/init')
    expect(res.headers.get('Cache-Control')).toEqual('no-cache, max-age=0')

    const resWithAutoRedirect = await fetch('http://localhost:3000')
    expect(resWithAutoRedirect.status).toEqual(200)
    expect(resWithAutoRedirect.url).toEqual('http://localhost:3000/init')
  })
  initFirstItemTest(() => page)
  afterAll(async () => {
    await browser.close()
  })
})
