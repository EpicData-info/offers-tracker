const Fs = require('fs');
const SimpleGit = require('simple-git');
const { GraphQLClient } = require('graphql-request');

const FetchStoreOffersQuery = Fs.readFileSync('./queries/FetchStoreOffersQuery.graphql', 'utf8');
const FetchStoreOffersByNamespaceQuery = Fs.readFileSync('./queries/FetchStoreOffersByNamespaceQuery.graphql', 'utf8');

class Main {
  constructor () {
    this.language = 'en';
    this.country = 'US';
    this.namespaces = []; // You can add here non-store namespaces e.g. ue (unreal engine market offers)
    
    this.ql = new GraphQLClient('https://graphql.epicgames.com/graphql', {
      headers: {
        Origin: 'https://epicgames.com',
      },
    });

    this.update();
  }

  async update () {
    console.log('Updating epicgames store offers...');
    await this.fetchAllOffers(FetchStoreOffersQuery, {
      country: this.country,
      locale: this.language,
      sortBy: 'lastModifiedDate',
      sortDir: 'DESC',
    }, (result) => {
      return result && result.Catalog && result.Catalog.searchStore || {};
    });
    
    for (let i = 0; i < this.namespaces.length; ++i) {
      const namespace = this.namespaces[i];
      console.log(`Updating offers for namespace ${namespace}...`);
      await this.fetchAllOffers(FetchStoreOffersByNamespaceQuery, {
        namespace,
        country: this.country,
        locale: this.language,
      }, (result) => {
        return result && result.Catalog && result.Catalog.catalogOffers || {};
      });
    }
    
    this.sync();
  }

  async sync () {
    const git = SimpleGit({
      baseDir: __dirname,
      binary: 'git',
    });
    const add = git.add([`${__dirname}/database/.`]);
    console.dir(add);
  }
  
  saveOffer (offer) {
    Fs.writeFile(`${__dirname}/database/offers/${offer.id}.json`, JSON.stringify(offer, null, 2), (error) => {
      // console.log(`${offer.id} = ${!error ? 'OK' : error}`);
    });
  }

  async fetchAllOffers (query, params, resultSelector) {
    const elements = [];
    let paging = {};
    do {
      const result = await this.fetchOffers(query, params, resultSelector, paging.start, paging.count);
      paging = result.paging;
      paging.start += paging.count;
      for (let i = 0; i < result.elements.length; ++i) {
        const element = result.elements[i];
        this.saveOffer(element);
      }
    } while (paging.start - 1000 < paging.total - paging.count);
  }

  async fetchOffers (query, params, resultSelector, start = 0, count = 1000) {
    try {
      let result = await this.ql.request(query, {
        ...params,
        start,
        count,
      });
      result = resultSelector(result);
      return result;
    } catch (err) {
      console.dir(err);
      if(!err.response.data) {
        console.dir(err);
        if (err.response && err.response.errors) console.log(JSON.stringify(err.response.errors, null, 2));
      }else data = err.response.data;
    }
  }
}

module.exports = new Main();
