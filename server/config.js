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
    'verteil-ui': 4200,
    'tomcat-vdc': 8081,
    'vdc-configurator': 8090,
    'entrygate-service': 8080,
    'auth-service': 8082,
    'agencymanagement-v1': 8083,
    'ordermanagement-v1': 8084,
    'offermanagement-v1': 8085,
    'ordermanagement': 8086,
    'offermanagement': 8087,
    'opendata': 8088,
    'payment': 8089,
    'connector-flyr': 8091,
    'connector-flyr-v1': 8092
  }
};
