import * as async_hooks from 'node:async_hooks';

import { Configuration, App, Logger } from '@midwayjs/core';
import * as AWSXRay from 'aws-xray-sdk';
import * as koa from '@midwayjs/koa';
import * as validate from '@midwayjs/validate';
import * as info from '@midwayjs/info';
import { join } from 'path';
import * as xrayKoa from 'aws-xray-sdk-koa2';
// import { DefaultErrorFilter } from './filter/default.filter';
// import { NotFoundFilter } from './filter/notfound.filter';
import { ReportMiddleware } from './middleware/report.middleware';
import { IMidwayLogger } from '@midwayjs/logger';

const context = {
  init: () => {
    const hooks = async_hooks.createHook({
      init(eid, _, tid) {
        if (context.store[tid]) {
          context.store[eid] = context.store[tid];
        }
      },
      destroy(eid) {
        delete context.store[eid];
      },
    });
    hooks.enable();
  },
  store: {},
  run: fn => {
    const eid = async_hooks.executionAsyncId();
    context.store[eid] = {};
    return fn();
  },
  set: (k, v) => {
    const eid = async_hooks.executionAsyncId();
    if (context.store[eid]) {
      context.store[eid][k] = v;
    } else {
      throw new Error('you should wrap your fn with context.run');
    }
  },
  get: k => {
    const eid = async_hooks.executionAsyncId();
    if (context.store[eid]) {
      return context.store[eid][k];
    } else {
      throw new Error('you should wrap your fn with context.run');
    }
  },
};

context.init();

async function getRequest1() {
  console.log('getRequest1', context.get('traceid'));
}

async function getRequest() {
  console.log('getRequest', context.get('traceid'));
  getRequest1();
}

@Configuration({
  imports: [
    koa,
    validate,
    {
      component: info,
      enabledEnvironment: ['local'],
    },
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  @App('koa')
  app: koa.Application;

  @Logger()
  logger: IMidwayLogger;

  async onReady() {
    // 捕获所有 HTTP 请求
    AWSXRay.captureHTTPsGlobal(require('http'));
    AWSXRay.captureHTTPsGlobal(require('https'));

    AWSXRay.setLogger(this.logger);

    this.app.use(xrayKoa.openSegment('test'));

    this.app.use((ctx, next) => {
      context.run(() => {
        context.set('traceid', ctx.get('x-amzn-trace-id'));
        getRequest();
        return next();
      });
    });
    // add middleware
    this.app.useMiddleware([ReportMiddleware]);
    // add filter
    // this.app.useFilter([NotFoundFilter, DefaultErrorFilter]);
  }
}
