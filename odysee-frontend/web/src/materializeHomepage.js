const { getMaterializedHomepageData } = require('./getHomepageJSON');

getMaterializedHomepageData(true)
  .then((data) => {
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
    const unresolvedChannels = new Set();
    Object.values(data).forEach((homepage) =>
      Object.values(homepage?.categories || {}).forEach((category) => {
        (category.immutableChannelIds || []).forEach((id) => immutableChannels.add(id));
        (category.unresolvedChannelIds || []).forEach((id) => unresolvedChannels.add(id));
      })
    );
    console.log( // eslint-disable-line no-console
      `Materialized ${entries} homepage entries across ${categories} categories; ` +
        `${immutableChannels.size} immutable channels, ${unresolvedChannels.size} unresolved source channels`
    );
  })
  .catch((err) => {
    console.error(err); // eslint-disable-line no-console
    process.exitCode = 1;
  });
