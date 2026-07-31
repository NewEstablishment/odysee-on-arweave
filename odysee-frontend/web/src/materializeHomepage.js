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
    console.log(`Materialized ${entries} homepage entries across ${categories} categories`); // eslint-disable-line no-console
  })
  .catch((err) => {
    console.error(err); // eslint-disable-line no-console
    process.exitCode = 1;
  });
