/* eslint-disable no-underscore-dangle */
/* eslint-disable no-console */
const pify = require('pify');
const requireFromApp = require('../helpers/require-from-app');
const { logBuildBanner } = require('../helpers/banner');
const { log, fatal } = require('../helpers/logger');

function splitWebpackConfig(webpackConfigs) {
  return [
    { webpack: webpackConfigs.serverSide, name: 'Server-side' },
    { webpack: webpackConfigs.clientSide, name: 'Client-side' },
  ];
}

function parseWebpackConfig(cfg) {
  const data = splitWebpackConfig(cfg);

  return {
    configs: data.map((d) => d.webpack),
    name: data.map((d) => d.name),
    folder: data.map((d) => d.webpack.output.path),
  };
}

module.exports = async function build(
  api,
  quasarConfFile,
  ctx,
  extensionRunner,
) {
  logBuildBanner(api, quasarConfFile.ctx);


  const { printWebpackErrors } = requireFromApp('@quasar/app/lib/helpers/print-webpack-issue');

  const webpack = requireFromApp('webpack');

  const Generator = requireFromApp('@quasar/app/lib/generator');
  const artifacts = requireFromApp('@quasar/app/lib/artifacts');
  const regenerateTypesFeatureFlags = requireFromApp('@quasar/app/lib/helpers/types-feature-flags');

  const generator = new Generator(quasarConfFile);

  const { webpackConf, quasarConf } = quasarConfFile;

  regenerateTypesFeatureFlags(quasarConf);

  const outputFolder = quasarConf.build.distDir;

  artifacts.clean(outputFolder);
  generator.build();

  if (typeof quasarConf.build.beforeBuild === 'function') {
    await quasarConf.build.beforeBuild({ quasarConf });
  }

  // run possible beforeBuild hooks
  await extensionRunner.runHook('beforeBuild', async (hook) => {
    log(`Extension(${hook.api.extId}): Running beforeBuild hook...`);
    await hook.fn(hook.api, { quasarConf });
  });

  // using quasarConfFile.ctx instead of argv.mode
  // because SSR might also have PWA enabled but we
  // can only know it after parsing the quasar.config.js file
  if (quasarConfFile.ctx.mode.pwa === true) {
    // need to build the custom service worker before renderer
    const Runner = requireFromApp('@quasar/app/lib/pwa');

    Runner.init(ctx);

    await Runner.build(quasarConfFile);
  }

  const routerBuilder = new Router(quasarConf, webpackConf.serverSide);

  const routerBuildPromise = routerBuilder.build();

  let webpackData = parseWebpackConfig(webpackConf);

  const compiler = webpack(webpackData.configs);

  compiler.run = pify(compiler.run);
  const { err, stats } = await compiler.run();

  if (err) {
    console.error(err.stack || err);

    if (err.details) {
      console.error(err.details);
    }

    process.exit(1);
  }

  artifacts.add(outputFolder);

  const statsArray = stats.stats || stats;

  statsArray.forEach((stat, index) => {
    if (stat.hasErrors() !== true) {
      return;
    }

    const summary = printWebpackErrors(webpackData.name[index], stats);
    console.log();
    fatal(`for "${webpackData.name[index]}" with ${summary}. Please check the log above.`, 'COMPILATION FAILED');
  });

  const printWebpackStats = requireFromApp('@quasar/app/lib/helpers/print-webpack-stats');

  console.log();

  statsArray.forEach((stat, index) => {
    printWebpackStats(
      stat,
      webpackData.folder[index],
      webpackData.name[index],
    );
  });

  // free up memory
  // eslint-disable-next-line no-void
  webpackData = void 0;

  logBuildBanner(api, quasarConfFile.ctx, {
    outputFolder,
    transpileBanner: quasarConf.__transpileBanner,
  });

  if (typeof quasarConf.build.afterBuild === 'function') {
    await quasarConf.build.afterBuild({ quasarConf });
  }

  // run possible afterBuild hooks
  await extensionRunner.runHook('afterBuild', async (hook) => {
    log(`Extension(${hook.api.extId}): Running afterBuild hook...`);
    await hook.fn(hook.api, { quasarConf });
  });

  await routerBuildPromise;
};
