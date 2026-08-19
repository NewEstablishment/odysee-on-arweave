require('../../config.cjs');

const { getMaterializedHomepageData } = require('./getHomepageJSON');

getMaterializedHomepageData(true)
  .then((data) => {
    if (!Object.keys(data).length) {
      throw new Error('Homepage materialization produced no homepage data');
    }
    const categories = Object.values(data).reduce(
      (count, homepage) => count + Object.keys(homepage?.categories || {}).length,
      0
    );
    const entries = Object.values(data).reduce(
      (count, homepage) =>
        count +
        Object.values(homepage?.categories || {}).reduce(
          (categoryCount, category) => categoryCount + (category.immutableIds || []).length,
          0
        ),
      0
    );
    const immutableChannels = new Set();
    Object.values(data).forEach((homepage) =>
      Object.values(homepage?.categories || {}).forEach((category) => {
        Object.values(category.immutableSigningChannelIds || {}).forEach((id) => immutableChannels.add(id));
      })
    );
    if (!categories || !entries) {
      throw new Error(`Homepage materialization produced ${categories} categories and ${entries} entries`);
    }
    console.log(
      // eslint-disable-line no-console
      `Materialized ${entries} homepage entries across ${categories} categories; ` +
        `${immutableChannels.size} selected immutable channels`
    );
  })
  .catch((err) => {
    console.error(err); // eslint-disable-line no-console
    process.exitCode = 1;
  });
