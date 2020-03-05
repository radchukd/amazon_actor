/* eslint-disable camelcase */
const Apify = require('apify');

Apify.main(async () => {
    const input = await Apify.getInput();
    const { keyword } = input;
    const requestQueue = await Apify.openRequestQueue();
    requestQueue.addRequest({
        url: `https://www.amazon.com/s?k=${keyword}`,
        userData: {
            label: 'search',
        },
    });

    const items = [];

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        maxRequestRetries: 2,
        maxRequestsPerCrawl: 100,
        maxConcurrency: 10,
        handlePageFunction: async ({ request, page, $ }) => {
            const { label } = request.userData;

            if (label === 'search') {
                await Apify.utils.enqueueLinks({
                    page,
                    requestQueue,
                    selector: 'div.s-search-results h2 > a',
                    pseudoUrls: [
                        'https://www.amazon.com/[.*]',
                    ],
                    transformRequestFunction: (req) => {
                        req.userData.label = 'item_page';
                        return req;
                    },
                });
            } else if (label === 'item_page') {
                await Apify.utils.puppeteer.injectJQuery(page);
                const item = await page.evaluate(() => {
                    const title = $('h1#title span:first-child')
                        .text()
                        .trim();
                    const description = $('div#featurebullets_feature_div')
                        .text()
                        .replace(/(\n|\t)/gm, '')
                        .trim();

                    return {
                        title,
                        description,
                    };
                });
                let asin = request.url.match(/dp\/(.*)\//);
                asin = asin ? asin[1] : null;
                item.itemUrl = request.url;
                item.keyword = keyword;

                requestQueue.addRequest({
                    url: `https://www.amazon.com/gp/offer-listing/${asin}`,
                    userData: {
                        label: 'item_offers',
                        item,
                    },
                });
            } else if (label === 'item_offers') {
                await Apify.utils.puppeteer.injectJQuery(page);
                const offers = await page.evaluate(() => {
                    const parsed = [];
                    $('div#olpOfferList div.olpOffer').each((_index, offer) => {
                        let shipping = $(offer).find('.olpShippingInfo').text().trim();
                        const match = shipping.match(/& (FREE) Shipping/);
                        shipping = match ? match[1] : shipping;

                        parsed.push({
                            offer: $(offer).find('span.olpOfferPrice').text().trim(),
                            condition: $(offer).find('span.olpCondition').text().trim(),
                            seller_name: $(offer).find('h3.olpSellerName').text().trim(),
                            shipping,
                        });
                    });
                    return parsed;
                });
                offers.map((item) => {
                    Object.assign(item, request.userData.item);
                });
                items.push(...offers);
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed too many times`);
            await Apify.pushData({
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },
    });
    await crawler.run();
    await Apify.pushData({
        items,
    });
});
