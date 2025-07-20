#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BelleNoorCdkStack } from '../lib/belle-noor-cdk-stack';

const app = new cdk.App();

new BelleNoorCdkStack(app, 'BelleNoorStackV12', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
