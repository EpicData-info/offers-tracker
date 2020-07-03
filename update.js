require('dotenv').config({ path: `${__dirname}/.env` });
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
    this.perPage = 1000;
    
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
    
    this.index();
    this.sync();
  }
  
  index () {
    console.log('Indexing...');
    const namespaces = {};
    const titles = {};
    
    const databasePath = `${__dirname}/database`;
    const offersPath = `${databasePath}/offers`;
    Fs.readdirSync(offersPath).forEach((fileName) => {
      if (fileName.substr(-5) !== '.json') return;
      try {
        const offer = JSON.parse(Fs.readFileSync(`${offersPath}/${fileName}`));
        if (offer.namespace) {
          if (!namespaces[offer.namespace]) {
            namespaces[offer.namespace] = [offer.id];
          } else {
            namespaces[offer.namespace].push(offer.id);
          }
        }
        titles[offer.id] = offer.title;
      } catch (error) {
        console.error(error);
      }
    });
    
    Fs.writeFileSync(`${databasePath}/namespaces.json`, JSON.stringify(namespaces, null, 2));
    Fs.writeFileSync(`${databasePath}/titles.json`, JSON.stringify(titles, null, 2));
  }

  async sync () {
    if (!process.env.GIT_REMOTE) return;
    console.log('Syncing with repo...');
    const git = SimpleGit({
      baseDir: __dirname,
      binary: 'git',
    });
    await git.addConfig('hub.protocol', 'https');
    await git.checkoutBranch('master');
    await git.add([`${__dirname}/database/.`]);
    const status = await git.status();
    const changesCount = status.created.length + status.modified.length + status.deleted.length + status.renamed.length;
    if (changesCount === 0) return;
    const commitMessage = `Update - ${new Date().toISOString()}`;
    await git.commit(commitMessage);
    await git.removeRemote('origin');
    await git.addRemote('origin', process.env.GIT_REMOTE);
    await git.push(['-u', 'origin', 'master']);
    console.log(`Changes has commited to repo with message ${commitMessage}`);
  }
  
  saveOffer (offer) {
    try {
      Fs.writeFileSync(`${__dirname}/database/offers/${offer.id}.json`, JSON.stringify(offer, null, 2));
    } catch (error) {
      console.log(`${offer.id} = ERROR`);
      console.error(error);
    }
  }

  sleep (time) {
    return new Promise((resolve) => {
      const sto = setTimeout(() => {
        clearTimeout(sto);
        resolve();
      }, time);
    });
  }

  async fetchAllOffers (query, params, resultSelector) {
    let paging = {};
    do {
      const result = await this.fetchOffers(query, params, resultSelector, paging.start, paging.count || this.perPage);
      paging = result.paging;
      paging.start += paging.count;
      for (let i = 0; i < result.elements.length; ++i) {
        const element = result.elements[i];
        this.saveOffer(element);
      }
    } while (paging.start - this.perPage < paging.total - paging.count);
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
    } catch (error) {
      if (error.response) {
        if (error.response.data) {
          const result = resultSelector(error.response.data);
          if (result && result.elements && result.paging) {
            return result;
          }
        }
        console.log(JSON.stringify(error.response, null, 2));
        console.log('Next attempt in 1s...');
        await this.sleep(1000);
        return this.fetchOffers(...arguments);
      } else {
        throw new Error(error);
      }
    }
  }
}

module.exports = new Main();
