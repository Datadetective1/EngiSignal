import type { ConnectorId } from './index';

/**
 * Native-format sample exports, one per Ready file connector.
 *
 * ── WHY THESE ARE NOT THE SAME AS /api/templates ────────────────────────────
 *
 * The templates endpoint hands back EngiSignal's own canonical column names,
 * which is what somebody building a file from scratch wants. These are the
 * opposite: they are shaped like what the vendor's own tooling actually emits,
 * complete with its capitalisation, its column ordering and its vocabulary —
 * `VENDOR_DAEMON`, `isv`, `Max Count`, `Sample Time`.
 *
 * That matters because the question a customer is really asking is "will my
 * lmstat output work?", and the honest way to answer is to show them a file
 * that looks like their lmstat output. It also exercises auto-detection: each
 * of these is recognised as its own source rather than falling back to generic,
 * and a test asserts exactly that.
 *
 * ── LICENSING ───────────────────────────────────────────────────────────────
 *
 * Every byte below is invented. These are not vendor samples, not extracts from
 * any customer's estate, and not copied from vendor documentation. They imitate
 * a published column layout — which is a fact about a format, not a work — and
 * contain fictional users, hosts and features.
 */

export interface ConnectorSample {
  fileName: string;
  description: string;
  csv: string;
}

export const CONNECTOR_SAMPLES: Partial<Record<ConnectorId, ConnectorSample>> = {
  flexnet: {
    fileName: 'engisignal-sample-flexnet-usage.csv',
    description: 'FlexNet / FLEXlm report-log style export',
    csv: [
      'DATE,TIME,FEATURE,FEATURE_VERSION,VENDOR_DAEMON,USER,HOST,SERVER_HOST,LICENSES_ISSUED,LICENSES_IN_USE,CHECKOUT_TIME,CHECKIN_TIME,STATUS,BORROWED',
      '2026-03-02,08:00,MECH_ENT,2026.1,ansyslmd,jhalvorsen,ws-4412,lic-prod-01,400,214,2026-03-02 08:04:11,2026-03-02 11:32:07,granted,FALSE',
      '2026-03-02,09:00,MECH_ENT,2026.1,ansyslmd,rkowalski,ws-2210,lic-prod-01,400,238,2026-03-02 09:12:44,2026-03-02 12:01:19,granted,FALSE',
      '2026-03-02,10:00,MECH_ENT,2026.1,ansyslmd,tnakamura,ws-8871,lic-prod-01,400,266,2026-03-02 10:02:03,2026-03-02 15:44:52,granted,TRUE',
      '2026-03-02,11:00,MECH_ENT,2025.2,ansyslmd,pmoreau,ws-1004,lic-prod-01,400,271,2026-03-02 11:15:00,2026-03-02 16:02:00,granted,FALSE',
      '2026-03-02,14:00,FLUENT,2026.1,ansyslmd,lschmidt,ws-6621,lic-prod-01,165,158,2026-03-02 14:01:00,2026-03-02 18:30:00,denied,FALSE',
      '2026-03-03,09:00,MECH_ENT,2026.1,ansyslmd,jhalvorsen,ws-4412,lic-prod-01,400,231,2026-03-03 09:00:00,2026-03-03 12:00:00,granted,FALSE',
      '2026-03-03,13:00,FLUENT,2026.1,ansyslmd,rkowalski,ws-2210,lic-prod-01,165,140,2026-03-03 13:00:00,2026-03-03 17:45:00,granted,FALSE',
    ].join('\n'),
  },
  rlm: {
    fileName: 'engisignal-sample-rlm-usage.csv',
    description: 'Reprise License Manager report-log style export',
    csv: [
      'date,isv,product,ver,user,host,rlm_server,pool,count,count_in_use,checkout_time,checkin_time,denials,roaming',
      '2026-03-02,altair,hwsolver,2026.0,dmoreau,ws-7781,rlm-prod-01,GLOBAL,500,312,2026-03-02T07:45:00,2026-03-02T12:10:00,0,no',
      '2026-03-02,altair,hwsolver,2026.0,kfitzgerald,ws-3320,rlm-prod-01,GLOBAL,500,318,2026-03-02T08:02:00,2026-03-02T16:40:00,0,no',
      '2026-03-02,altair,optistruct,2026.0,rsingh,ws-9012,rlm-prod-01,EMEA,120,88,2026-03-02T09:20:00,2026-03-02T14:05:00,2,yes',
      '2026-03-03,altair,hwsolver,2026.0,dmoreau,ws-7781,rlm-prod-01,GLOBAL,500,301,2026-03-03T07:50:00,2026-03-03T11:55:00,0,no',
      '2026-03-03,altair,optistruct,2026.0,jbeaumont,ws-4455,rlm-prod-01,EMEA,120,95,2026-03-03T10:15:00,2026-03-03T15:30:00,0,no',
    ].join('\n'),
  },
  dsls: {
    fileName: 'engisignal-sample-dsls-usage.csv',
    description: 'Dassault Systèmes DSLS usage export',
    csv: [
      'Date,License Name,Product Line,License Version,User ID,Client Host,Server ID,Max Count,In Use,Token,License Type,Acquire Time,Release Time',
      '2026-03-02,CAT_MECH_DES,CATIA,R2026x,mlefebvre,ws-2201,dsls-prod-01,300,188,4,Token,2026-03-02 08:15:00,2026-03-02 12:45:00',
      '2026-03-02,CAT_MECH_DES,CATIA,R2026x,gtorres,ws-6690,dsls-prod-01,300,192,4,Token,2026-03-02 08:40:00,2026-03-02 17:20:00',
      '2026-03-02,ENO_COLLAB,ENOVIA,R2026x,hpetersen,ws-1187,dsls-prod-01,150,96,2,Token,2026-03-02 09:05:00,2026-03-02 13:10:00',
      '2026-03-03,CAT_MECH_DES,CATIA,R2026x,mlefebvre,ws-2201,dsls-prod-01,300,201,4,Token,2026-03-03 08:20:00,2026-03-03 16:00:00',
      '2026-03-03,ENO_COLLAB,ENOVIA,R2026x,sabadi,ws-3345,dsls-prod-01,150,102,2,Token,2026-03-03 10:30:00,2026-03-03 15:45:00',
    ].join('\n'),
  },
  sentinel: {
    fileName: 'engisignal-sample-sentinel-usage.csv',
    description: 'Sentinel RMS interval snapshot export',
    csv: [
      'Sample Time,Feature Name,Feature Version,Client User,Client Host,License Server,Total Licenses,Licenses In Use,Peak Usage,Sublicense,Denied Requests',
      '2026-03-02 08:00:00,SOLIDCAM_PRO,2026.1,wanderson,ws-3301,lserv-prod-01,180,112,126,SL-A,0',
      '2026-03-02 09:00:00,SOLIDCAM_PRO,2026.1,cmartinez,ws-3390,lserv-prod-01,180,124,131,SL-A,0',
      '2026-03-02 10:00:00,SOLIDCAM_PRO,2026.1,tokafor,ws-2255,lserv-prod-01,180,139,144,SL-A,3',
      '2026-03-03 09:00:00,SOLIDCAM_PRO,2026.1,wanderson,ws-3301,lserv-prod-01,180,118,129,SL-A,0',
      '2026-03-03 11:00:00,SOLIDCAM_PRO,2026.1,rnovak,ws-7788,lserv-prod-01,180,133,141,SL-A,1',
    ].join('\n'),
  },
};

export function connectorSample(id: string): ConnectorSample | undefined {
  return CONNECTOR_SAMPLES[id.toLowerCase() as ConnectorId];
}
