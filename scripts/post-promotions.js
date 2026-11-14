// Legacy entrypoint intentionally retired: all posts use the durable queue.
console.error('Gebruik npm run manage -- correct --tag TAG --name NAAM --type promoted|demoted --reset YYYY-MM-DD, daarna npm run manage -- deliver. Preview: npm run preview:assets.');
process.exitCode = 1;
