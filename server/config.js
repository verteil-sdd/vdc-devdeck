import path from 'path';
import os from 'os';

const HOME = os.homedir();

export const config = {
  port: parseInt(process.env.PORT || '9990', 10),
  host: process.env.HOST || '0.0.0.0',
  verteilDir: process.env.VERTEIL_DIR || path.join(HOME, 'Desktop/verteil'),
  awsConfigScript: path.join(HOME, 'awsconfig/configure.sh'),
  sdkmanJavaDir: path.join(HOME, '.sdkman/candidates/java'),
  dataDir: path.join(HOME, '.vdc-devdeck'),
  logsDir: path.join(HOME, '.vdc-devdeck/logs'),
  overridesFile: path.join(HOME, '.vdc-devdeck/overrides.json'),

  // Anti-Lag JVM Tuning defaults
  defaultJvmMemory: {
    min: '128m',
    max: '384m'
  },
  heavyJvmMemory: {
    min: '256m',
    max: '512m'
  },
  antiLagFlags: [
    '-XX:+TieredCompilation',
    '-XX:TieredStopAtLevel=1',
    '-XX:+UseSerialGC'
  ],

  // Known stack configurations
  v1Stack: [
    'verteil-ui',
    'tomcat-vdc',
    'vdc-configurator',
    'agencymanagement-v1',
    'auth-service',
    'entrygate-service',
    'ordermanagement-v1',
    'offermanagement-v1',
    'payment',
    'opendata'
  ],
  v3Stack: [
    'ordermanagement',
    'offermanagement'
  ],

  // Known JDK defaults mapping
  jdkDefaults: {
    'vdc-configurator': '18.0.2-sem',
    'opendata': '18.0.2-sem',
    'agencymanagement-v1': '17.0.9-amzn',
    'entrygate-service': '17.0.9-amzn',
    'offermanagement-v1': '25-amzn',
    'ordermanagement-v1': '21.0.1-amzn',
    'auth-service': '21.0.1-amzn',
    'payment': '21.0.1-amzn',
    'ordermanagement': '21.0.1-amzn',
    'offermanagement': '21.0.1-amzn',
    'connector-flyr': '21.0.1-amzn',
    'connector-flyr-v1': '21.0.1-amzn'
  },

  // Known default ports
  portDefaults: {
    'verteil-ui': 5000,
    'tomcat-vdc': 2243,
    'vdc-configurator': 8090,
    'entrygate-service': 8081,
    'auth-service': 9000,
    'agencymanagement-v1': 8098,
    'ordermanagement-v1': 9003,
    'offermanagement-v1': 8097,
    'ordermanagement': 8091,
    'offermanagement': 8093,
    'opendata': 9010,
    'payment': 8051,
    'connector-flyr': 7070,
    'connector-flyr-v1': 9024
  },

  // Default JDWP Remote Debugging Port configuration
  defaultDebugPort: 5005,
  debugPortDefaults: {
    'entrygate-service': 5005,
    'tomcat-vdc': 8000,
    'vdc-configurator': 5006,
    'auth-service': 5007,
    'agencymanagement-v1': 5008,
    'ordermanagement-v1': 5009,
    'offermanagement-v1': 5010,
    'payment': 5011,
    'opendata': 5012,
    'ordermanagement': 5013,
    'offermanagement': 5014,
    'connector-flyr': 5015,
    'connector-flyr-v1': 5016
  }
};
