/* eslint-disable camelcase */
const Apify = require('apify');

Apify.main(async () => {
    const input = await Apify.getInput();
    const { keyword } = input;
    const sources = [`https://www.amazon.com/s?k=${keyword}`];
    const searchList = await Apify.openRequestList('search', sources);
    const itemQueue = await Apify.openRequestQueue();

    const searchCrawler = new Apify.PuppeteerCrawler({
        requestList: searchList,
        maxRequestRetries: 2,
        maxRequestsPerCrawl: 100,
        maxConcurrency: 10,
        handlePageFunction: async ({ page }) => {
            await Apify.utils.enqueueLinks({
                page,
                requestQueue: itemQueue,
                selector: 'div.s-search-results h2 > a',
                pseudoUrls: [
                    'https://www.amazon.com/[.*]',
                ],
            });
        },
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed too many times`);
            await Apify.pushData({
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },
    });

    const itemCrawler = new Apify.PuppeteerCrawler({
        requestQueue: itemQueue,
        maxRequestRetries: 2,
        maxRequestsPerCrawl: 100,
        maxConcurrency: 10,
        handlePageFunction: async ({ request, page, $ }) => {
            await Apify.utils.puppeteer.injectJQuery(page);
            const item = await page.evaluate(() => {
                const title = $('h1#title span:first-child')
                    .text()
                    .trim();
                const description = $('div#featurebullets_feature_div')
                    .text()
                    .replace(/(\n|\t)/gm, '')
                    .trim();
                const seller_name = $('div#merchant-info')
                    .text()
                    .match(/sold by (\w+)/i);
                const offer = $('#buybox span.a-color-price:first-child')
                    .text()
                    .match(/(\$\d+(\.\d+)?)/);
                const shipping = $('#buybox span.a-color-secondary')
                    .text()
                    .match(/(\$\d+(\.\d+)?|free)/);

                return {
                    title,
                    description,
                    seller_name: seller_name ? seller_name[1] : '',
                    offer: offer ? offer[1] : '',
                    shipping: shipping ? shipping[1] : '',
                };
            });
            const asin = request.url.match(/dp\/(.*)\//);
            item.asin = asin ? asin[1] : null;
            item.itemUrl = request.url;

            await Apify.pushData(item);
        },
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed too many times`);
            await Apify.pushData({
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },
    });

    await searchCrawler.run();
    await itemCrawler.run();
});
