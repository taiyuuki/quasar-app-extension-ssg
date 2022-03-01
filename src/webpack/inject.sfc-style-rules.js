/* eslint-disable global-require */
const path = require('path');
const { merge } = require('webpack-merge');
const appRequire = require('../helpers/app-require');

const absoluteUrlRE = /^[a-z][a-z0-9+.-]*:/i;
const protocolRelativeRE = /^\/\//;
const templateUrlRE = /^[{}[\]#*;,'§$%&(=?`´^°<>]/;
const rootRelativeUrlRE = /^\//;

/**
 * Inspired by loader-utils > isUrlRequest()
 * Mimics Webpack v4 & css-loader v3 behavior
 */
function shouldRequireUrl(url) {
  return (
    // an absolute url and it is not `windows` path like `C:\dir\file`:
    (absoluteUrlRE.test(url) === true && path.win32.isAbsolute(url) === false)
    // a protocol-relative:
    || protocolRelativeRE.test(url) === true
    // some kind of url for a template:
    || templateUrlRE.test(url) === true
    // not a request if root isn't set and it's a root-relative url
    || rootRelativeUrlRE.test(url) === true
  ) === false;
}

function create(
  rule,
  modules,
  pref,
  {
    cssnano, postCssConfigFile, postcssRTL, quasarCssPaths, cssVariables,
  },
  loader,
  loaderOptions,
) {
  if (rule.uses.has('null-loader')) {
    rule.uses.delete('null-loader');
  }

  if (rule.uses.has('mini-css-extract')) {
    rule.uses.delete('mini-css-extract');
  }

  /**
  * replace vue-style-loader by @freddy38510/vue-style-loader
  * which has consistent ssrId hashes between client and server
  * https://github.com/freddy38510/vue-style-loader/commit/54d6307692790136dfbda64ead5f8ad35d46390f
  */
  if (rule.uses.has('vue-style-loader')) {
    rule
      .use('vue-style-loader')
      .loader('@freddy38510/vue-style-loader')
      .tap((options) => merge(options, {
        ssrId: true,
      }));
  } else {
    rule
      .use('vue-style-loader')
      .loader('@freddy38510/vue-style-loader')
      .options({
        sourceMap: pref.sourceMap,
        ssrId: true,
      })
      .before('css-loader');
  }

  let numberOfLoaders = loader ? 1 : 0;

  if (loader === 'sass-loader') {
    numberOfLoaders = 2;
  }

  const cssLoaderOptions = {
    sourceMap: pref.sourceMap,
    url: shouldRequireUrl,
    importLoaders:
      1 // stylePostLoader injected by vue-loader
      + 1 // postCSS loader
      + (pref.minify ? 1 : 0) // postCSS with cssnano
      + numberOfLoaders,
  };

  if (modules) {
    Object.assign(cssLoaderOptions, {
      modules: {
        localIdentName: '[name]_[local]_[hash:base64:5]',
        exportOnlyLocals: false,
      },
    });
  }

  if (rule.uses.has('css-loader')) {
    rule
      .use('css-loader')
      .tap(() => cssLoaderOptions);
  } else {
    rule.use('css-loader')
      .loader('css-loader')
      .options(cssLoaderOptions);
  }

  if (pref.minify && !rule.uses.has('cssnano')) {
    // needs to be applied separately,
    // otherwise it messes up RTL
    rule
      .use('cssnano')
      .loader('postcss-loader')
      .options({
        sourceMap: pref.sourceMap,
        postcssOptions: {
          plugins: [
            cssnano({
              preset: ['default', {
                mergeLonghand: false,
                convertValues: false,
                cssDeclarationSorter: false,
                reduceTransforms: false,
              }],
            }),
          ],
        },
      });
  }

  if (!rule.uses.has('postcss-loader')) {
    // need a fresh copy, otherwise plugins
    // will keep on adding making N duplicates for each one
    delete require.cache[postCssConfigFile];
    // eslint-disable-next-line import/no-dynamic-require
    const postCssConfig = require(postCssConfigFile);
    const postCssOpts = { sourceMap: pref.sourceMap, ...postCssConfig };

    if (pref.rtl) {
      const postcssRTLOptions = pref.rtl === true ? {} : pref.rtl;
      if (
        typeof postCssConfig.plugins !== 'function'
        && (postcssRTLOptions.fromRTL === true || typeof postcssRTLOptions === 'function')
      ) {
        postCssConfig.plugins = postCssConfig.plugins || [];
        postCssOpts.plugins = (ctx) => {
          const plugins = [...postCssConfig.plugins];
          const isClientCSS = quasarCssPaths.every(
            (item) => ctx.resourcePath.indexOf(item) === -1,
          );
          plugins.push(postcssRTL(
            typeof postcssRTLOptions === 'function'
              ? postcssRTLOptions(isClientCSS, ctx.resourcePath)
              : {
                ...postcssRTLOptions,
                fromRTL: isClientCSS,
              },
          ));
          return plugins;
        };
      } else {
        postCssOpts.plugins.push(postcssRTL(postcssRTLOptions));
      }
    }

    rule.use('postcss-loader')
      .loader('postcss-loader')
      .options(postCssOpts);
  }

  if (loader && !rule.uses.has(loader)) {
    rule
      .use(loader)
      .loader(loader)
      .options({
        sourceMap: pref.sourceMap,
        ...loaderOptions,
      });

    if (loader === 'sass-loader') {
      if (
        loaderOptions
        && loaderOptions.sassOptions
        && loaderOptions.sassOptions.indentedSyntax
      ) {
        rule
          .use('quasar-sass-variables-loader')
          .loader(cssVariables.loaders.sass);
      } else {
        rule
          .use('quasar-scss-variables-loader')
          .loader(cssVariables.loaders.scss);
      }
    }
  }
}

function injectRule(
  chain,
  pref,
  args,
  lang,
  test,
  loader = undefined,
  loaderOptions = undefined,
) {
  const baseRule = chain.module.rule(lang).test(test).before('vue');

  // rules for Vue SFC <style module>
  const modulesRule = baseRule.oneOf('modules-query').resourceQuery(/module/);

  // rules for Vue SFC <style>
  const vueNormalRule = baseRule
    .oneOf('vue')
    .resourceQuery(/\?vue/)
    .after('modules-query');

  create(modulesRule, true, pref, args, loader, loaderOptions);
  create(vueNormalRule, false, pref, args, loader, loaderOptions);
}

module.exports = function injectSFCStyleRules({ appDir, resolve }, chain, pref) {
  const cssVariables = appRequire(
    '@quasar/app/lib/helpers/css-variables',
    appDir,
  );
  const postCssConfigFile = resolve.app('.postcssrc.js');
  const quasarCssPaths = [
    path.join('node_modules', 'quasar', 'dist'),
    path.join('node_modules', 'quasar', 'src'),
    path.join('node_modules', '@quasar'),
  ];

  let cssnano;
  let postcssRTL;

  if (pref.minify) {
    cssnano = appRequire('cssnano', appDir);
  }
  if (pref.rtl) {
    postcssRTL = appRequire('postcss-rtl', appDir);
  }

  const args = {
    cssVariables, postCssConfigFile, quasarCssPaths, cssnano, postcssRTL,
  };

  injectRule(
    chain,
    pref,
    args,
    'css',
    /\.css$/,
  );

  injectRule(
    chain,
    pref,
    args,
    'stylus',
    /\.styl(us)?$/,
    'stylus-loader',
    pref.stylusLoaderOptions,
  );

  injectRule(
    chain,
    pref,
    args,
    'scss',
    /\.scss$/,
    'sass-loader',
    merge(
      { sassOptions: { outputStyle: /* required for RTL */ 'expanded' } },
      pref.scssLoaderOptions,
    ),
  );

  injectRule(
    chain,
    pref,
    args,
    'sass',
    /\.sass$/,
    'sass-loader',
    merge(
      {
        sassOptions: {
          indentedSyntax: true,
          outputStyle: /* required for RTL */ 'expanded',
        },
      },
      pref.sassLoaderOptions,
    ),
  );

  injectRule(
    chain,
    pref,
    args,
    'less',
    /\.less$/,
    'less-loader',
    pref.lessLoaderOptions,
  );
};