const { readFileSync } = require('fs');
const { isPlainObject, isString, capitalize, pick } = require('@ntks/toolbox');

const {
  META_DIR_NAME, DEFAULT_PATH_SCHEMA,
  generateIdFromDate,
  resolvePathFromRootRelative, resolvePathFromParams,
  getGlobalConfigDirPath, getConfig,
  getImageFileNames, readDirDeeply, readEntity, readMeta, readData, saveData, ensureDirExists,
} = require('../core');

function getGlobalAppRootDirPath() {
  return `${getGlobalConfigDirPath()}/apps`;
}

function getGlobalAppDirPath(appName) {
  return `${getGlobalAppRootDirPath()}/${appName}`;
}

function getAppConfig(rootPath) {
  return getConfig('app', rootPath);
}

function resolveMeta(dirPath) {
  const meta = readMeta(dirPath);
  const appMeta = readData(`${dirPath}/${META_DIR_NAME}/app.yml`);

  if (!meta && !appMeta) {
    return;
  }

  if (meta) {
    return appMeta ? { ...meta, app: { ...(meta.app || {}), ...appMeta } } : meta;
  }

  return { app: appMeta }
}

function resolveAppMeta(params, categorized, dataSourcePath) {
  const meta = {};

  let collectionMeta

  if (categorized) {
    const cateDirPath = `${dataSourcePath}/${params.category}`;
    const cateMeta = resolveMeta(cateDirPath);

    if (cateMeta) {
      if (cateMeta.app === false) {
        return false;
      }

      meta.category = cateMeta;
    }

    collectionMeta = resolveMeta(`${cateDirPath}/${params.collection}`);
  } else {
    collectionMeta = resolveMeta(`${dataSourcePath}/${params.collection}`);
  }

  if (collectionMeta) {
    if (collectionMeta.app === false) {
      return false;
    }

    meta.collection = collectionMeta;
  }

  return meta;
}

function resolveRoute(params, meta, routeMap, categorized) {
  const cateName = categorized ? params.category : 'kb';

  if (!routeMap[cateName]) {
    routeMap[cateName] = { name: cateName, path: cateName, children: [] }

    if (categorized) {
      const cateMeta = meta.category;

      if (cateMeta && cateMeta.title) {
        routeMap[cateName].meta = { text: cateMeta.title };
      }
    }
  }

  const route = { name: `${cateName}${capitalize(params.collection)}`, path: `${cateName}/${params.collection}` };
  const collectionMeta = meta.collection;

  if (collectionMeta && collectionMeta.title) {
    route.meta = { text: collectionMeta.title };
  }

  routeMap[cateName].children.push(route);
}

function orderRoutesAlphabetically(routeMap) {
  return Object.values(routeMap).sort((a, b) => a.name > b.name ? 1 : -1);
}

function orderRoutes(routeMap, specificOrder, categorized, dataSourcePath, level = 1) {
  if (categorized && level === 1) {
    Object.entries(routeMap).forEach(([k, v]) => {
      if (v.children.length === 0) {
        return;
      }

      const meta = resolveMeta(`${dataSourcePath}/${k}`);
      const childMap = v.children.reduce((p, c) => ({ ...p, [c.name]: c }), {});
      const childrenOrder = ((meta.app || {}).order || meta.order || []).map(c => `${k}${capitalize(c)}`);

      routeMap[k].children = orderRoutes(childMap, childrenOrder, false);
    });
  }

  if (specificOrder.length === 0) {
    return orderRoutesAlphabetically(routeMap);
  }

  const ordered = [];

  specificOrder.forEach(cateName => {
    const route = routeMap[cateName];

    if (route) {
      ordered.push(route);

      delete routeMap[cateName];
    }
  });

  return [].concat(ordered, orderRoutesAlphabetically(routeMap));
}

function resolveParamPathParts(pathSchema) {
  return pathSchema.split('/').map(part => part.slice(1));
}

function generateId(date) {
  const randomStr = Array.from(new Array(8)).map(() => (Math.ceil(Math.random() * 36) - 1).toString(36)).join('');

  return `${generateIdFromDate(date)}-${randomStr}`;
}

function resolveRecords(collectionPath, paramArr, parentParams) {
  const records = [];

  readDirDeeply(collectionPath, paramArr, parentParams, (_, params) => {
    const recordPath = resolvePathFromParams(paramArr.join('/'), params);
    const distPath = `${collectionPath}/${recordPath}`;
    const { content, ...others } = readEntity(distPath) || {};
    const imageMap = {};

    getImageFileNames(distPath).forEach(fileName => {
      const baseName = fileName.split('.').slice(0, -1).join('.');

      if (['cover', 'banner'].includes(baseName)) {
        imageMap[baseName] = readFileSync(`${distPath}/${fileName}`).toString('base64');
      }
    });

    records.push({
      id: generateId(others.date),
      path: recordPath,
      ...pick(others, ['title', 'description', 'date', 'tags']),
      ...imageMap,
    });
  });

  return records;
}

function resolveAppInfo(config) {
  const dataSourcePath = resolvePathFromRootRelative(config.data || './data');
  const { path = DEFAULT_PATH_SCHEMA, app: appSpecific = {}, ...others } = resolveMeta(dataSourcePath) || {};

  if (appSpecific === false) {
    return false;
  }

  const paramArr = resolveParamPathParts(path);

  if (!['category', 'collection'].includes(paramArr[0])) {
    return false;
  }

  const app = { name: config.name, title: config.title || DEFAULT_APP_TITLE, source: dataSourcePath };

  const categorized = paramArr[0] === 'category';
  const recordParamPathArr = paramArr.splice(categorized ? 2 : 1);

  const routeMap = {};
  const collectionMap = {};

  readDirDeeply(dataSourcePath, paramArr, {}, (_, params) => {
    const meta = resolveAppMeta(params, categorized, dataSourcePath);

    if (meta === false) {
      return;
    }

    let mapKey;
    let collectionPath;

    if (categorized) {
      mapKey = `${params.category}${capitalize(params.collection)}`;
      collectionPath = `${params.category}/${params.collection}`
    } else {
      mapKey = collectionPath = params.collection;
    }

    resolveRoute(params, meta, routeMap, categorized);

    const resolvedRecordParamPathArr = meta.collection && meta.collection.path ? resolveParamPathParts(meta.collection.path) : recordParamPathArr;

    collectionMap[mapKey] = {
      id: generateId(),
      title: meta.collection && meta.collection.title,
      path: collectionPath,
      records: resolveRecords(`${dataSourcePath}/${collectionPath}`, resolvedRecordParamPathArr, params),
    };
  });

  app.routes = orderRoutes(routeMap, appSpecific.order || others.order || [], categorized, dataSourcePath);

  return { app, db: collectionMap };
}

function initApp() {
  const config = getAppConfig();

  if (!isPlainObject(config) || !config.name || !isString(config.name)) {
    return Promise.resolve();
  }

  const resolved = resolveAppInfo(config);

  if (resolved === false) {
    return Promise.resolve();
  }

  const distAppDirPath = getGlobalAppDirPath(config.name);

  ensureDirExists(distAppDirPath);
  ['app', 'db'].forEach(k => resolved[k] && saveData(`${distAppDirPath}/${k}.json`, JSON.stringify(resolved[k], null, 2)));

  return Promise.resolve(config);
}

module.exports = { getGlobalAppRootDirPath, getGlobalAppDirPath, getAppConfig, initApp };
