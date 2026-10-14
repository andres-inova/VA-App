// The fields of clients, client contacts, VAs and applicants, grouped into sections. The record pages and the edit
// forms use this list. Most keys are the names the fields had in Zoho CRM, where the records came from in 2026
// (fields that are new in the app have new names); the saved records use these keys, so don't rename one.
// To add a field, add one line to a section.
//
// Field types: text, email, phone, url, textarea, int, num (a number that may have a decimal), money, date, bool,
// pick (one choice from `options`), multi (several choices from `options`), tags (comma-separated words),
// owner (an admin's name), lookup (one other record, `to` = its kind), lookups (several other records),
// file (files of that kind, added on the record page). int and num fields can have `min`, `max` and `step`.

const f = (key, label, type = 'text', more = {}) => ({ key, label, type, ...more });

// Hiring steps for applicants, in order (from the "Application Process" document), and the two ways an
// applicant can leave before being hired.
export const STEPS = ['New application', 'Screening call scheduled', 'Screening call done', 'Offer sent', 'Training pending', 'In training', 'Training done', 'Hired'];
export const CLOSED = ['Declined', 'Ghosted'];

// The scoring sheets. Resume score ("Applicant Scoring - Hiring"): five parts adding up to 10; 8 or more means
// invite to a screening call. Screening call ("Applicant Scoring System"): each area 1-5, overall = the average
// times 2. The first four areas must be scored, and anyone under 4 in any of the first three should not be hired.
const RESUME_PARTS = [['Resume_Phone_Inbound', 'Phone / inbound', 3], ['Resume_Sales_Background', 'Sales background', 2],
  ['Resume_Communication', 'Communication quality', 2], ['Resume_Reliability', 'Reliability and availability', 1.5], ['Resume_Bonus_Fit', 'Bonus fit', 1.5]];
const CALL_AREAS = [['pre_Time_Availability_Consistency_Flexibility', 'Time availability'], ['pre_Accountability', 'Accountability'],
  ['pre_Personality', 'Personality'], ['pre_Industry_Knowledge', 'Industry knowledge'], ['pre_Tech_Knowledge', 'Tech skills'],
  ['pre_Communication', 'Communication'], ['pre_Sales', 'Sales'], ['pre_Scheduling', 'Scheduling'], ['pre_Customer_Service', 'Customer service']];
const CALL_HINTS = { pre_Time_Availability_Consistency_Flexibility: 'Consistency and flexibility.', pre_Communication: 'Etiquette, confidence, language and tone.' };
const CALL_REQUIRED = 4;
const CALL_MUST_BE_4 = 3;
export const RESUME_INVITE = 8;

const scored = (v) => v !== null && v !== undefined && v !== '';
const round1 = (n) => Math.round(n * 10) / 10;

// The resume score: { total, missing (parts not scored) }, or null when nothing is scored yet.
export function resumeScore(d) {
  const parts = RESUME_PARTS.filter(([k]) => scored(d[k]));
  if (!parts.length) return null;
  return { total: round1(parts.reduce((sum, [k]) => sum + Number(d[k]), 0)), missing: RESUME_PARTS.length - parts.length };
}

// The screening call score: { overall, missing (required areas not scored), low (areas under 4 that rule the
// applicant out) }, or null when nothing is scored yet.
export function callScore(d) {
  const areas = CALL_AREAS.filter(([k]) => scored(d[k]));
  if (!areas.length) return null;
  return {
    overall: round1((areas.reduce((sum, [k]) => sum + Number(d[k]), 0) / areas.length) * 2),
    missing: CALL_AREAS.slice(0, CALL_REQUIRED).filter(([k]) => !scored(d[k])).map(([, label]) => label),
    low: CALL_AREAS.slice(0, CALL_MUST_BE_4).filter(([k]) => scored(d[k]) && Number(d[k]) < 4).map(([, label]) => label),
  };
}

// The offer checklist, from "Sending Offer Letter and Running Background Check".
export const OFFER_ITEMS = [['Offer_W9', 'W-9 form received'], ['Offer_State_ID', 'Copy of state ID received'],
  ['Offer_Agreement', 'Subcontractor Agreement signed (SignNow)'], ['Offer_Onboarding_Form', 'Onboarding form filled in (Tally)'],
  ['Offer_Background_Check', 'Background check passed (Checkr)'], ['Offer_Slack', 'Joined Slack']];

// The built-in fields. Admins can change them on Settings > Fields; those changes are kept in the field_layouts
// table and laid over these (see MODULES below).
const BASE = {
  clients: {
    label: 'Clients', one: 'client',
    nameKey: 'Account_Name', statusKey: 'Status', statuses: ['Current', 'Paused', 'Offboarded'],
    sections: [
      { title: 'Client information', fields: [
        f('Account_Name', 'Client name', 'text', { required: true }),
        f('Status', 'Status', 'pick', { options: ['Current', 'Paused', 'Offboarded'] }),
        f('Contact', 'Main contact', 'lookup', { to: 'contacts', hint: "One of this client's contacts." }),
        f('Email', 'Email', 'email'),
        f('Phone', 'Phone', 'phone'),
        f('Website', 'Website', 'url'),
        f('Location', 'Location'),
        f('Timezone', 'Time zone', 'pick', { options: ['EST', 'CST', 'MST', 'PST'] }),
        f('Shift', 'Shift (business hours)', 'pick', { options: ['8am - 4pm', '8am - 5pm', '8:30am - 4pm', '8:30am - 4:30pm', '8:30am - 5pm', '9am - 5pm', '24/7'] }),
        f('Package_Hours', 'Package hours'),
        f('Service_Start_Date', 'Service start date', 'date'),
        f('Paused_Date', 'Last paused/unpaused date', 'date'),
        f('Offboarded_Date', 'Offboarded date', 'date'),
        f('VA_Roles_Needed', 'VA roles needed', 'multi', { options: ['Customer service / phone answering', 'Scheduling & dispatch', 'Lead follow-up', 'Invoicing & billing', 'Recruiting & hiring support', 'Feedback & reputation management'] }),
        f('Feedback_Frequency', 'Feedback frequency', 'pick', { options: ['Weekly', 'Monthly', 'Quarterly'] }),
        f('Owner', 'Client owner', 'owner'),
        f('Tag', 'Tags', 'tags'),
      ] },
      { title: 'Business', fields: [
        f('Industry', 'Industry', 'pick', { options: ['Home Cleaning', 'Commercial Cleaning', 'AirBNB', 'Landscaping', 'Property Mgmt', 'Junk Removal', 'Painting', 'Lead Gen', 'Moving & Delivery', 'Other'] }),
        f('Team_Size', 'No. of employees', 'int'),
        f('Full_part_time_techs', 'Full/part-time techs?', 'pick', { options: ['Full-time', 'Part-time'] }),
        f('Employee_IC', 'Employee/IC', 'pick', { options: ['Option 1', 'Option 2'] }),
        f('Bilingual', 'Bilingual', 'bool'),
        f('Annual_Revenue', 'Annual revenue', 'money'),
        f('Monthly_Revenue_Business', 'Monthly revenue (business)', 'pick', { options: ['Under $10K', '$10K-$25K', '$25K+'] }),
        f('Business_Age', 'Business age', 'int'),
        f('Business_Stability', 'Business stability', 'int'),
        f('Inova_Keeper_Score', 'InoVA keeper score', 'int'),
        f('Client_Referral_Score', 'Client referral score', 'int'),
        f('Phone_Software', 'Phone software', 'pick', { options: ['Grasshopper,', 'Ring Central', 'Open Phone', 'Google Voice', 'Zoom Calling', 'Dial Pad', 'Phone.Com', 'Nextiva', 'Ooma', 'HouseCall PRO', 'Go High Level', 'Other'] }),
        f('CRM_Software', 'CRM software', 'pick', { options: ['Launch27', 'ZenMaid', 'Booking Koala', 'Jobber', 'Maid Central', 'HouseCall PRO', 'Clean Core', 'Other'] }),
      ] },
      { title: 'Billing', fields: [
        f('Invoice_Method', 'Invoice method', 'pick', { options: ['Charge', 'Email'] }),
        f('Invoice_Date', 'Invoice date', 'multi', { options: ['1st', '16th', '22nd'] }),
        f('Last_Price_Increase_Date', 'Last price increase date', 'date'),
        f('Billing_Notes', 'Billing notes', 'textarea'),
      ] },
      { title: 'Referrals', fields: [
        f('Account_Source', 'Client source', 'pick', { options: ['Email', 'Facebook', 'Instagram', 'Website', 'Referral - Write in source in next field', 'Referral by Client - Write in client in next field', 'Referral - Chris Schwab', 'Referral - Julie Lesage', 'Google', 'Other'] }),
        f('Referred1', 'Referred?', 'bool'),
        f('Referral_Date', 'Date referred', 'date'),
        f('Chris_referral', 'Chris referral?', 'bool'),
        f('Referred_by', 'Referred by', 'lookups', { to: 'clients', reverse: 'Clients referred' }),
      ] },
      { title: 'Notes and documents', fields: [
        f('Description', 'Description', 'textarea'),
        f('VA_Service_History', 'VA service history', 'textarea'),
        f('Unique_Processes', 'Unique processes', 'textarea'),
        f('Contract', 'Contract', 'file'),
      ] },
      { title: 'Sales call', fields: [
        f('Admin_Staff_Details', 'Admin staff details', 'textarea'),
        f('Sales_Call_Lead_Sources', 'Lead sources', 'multi', { options: ['Option 1', 'Google LSA', 'Thumbtack', 'Yelp', 'Organic', "Angie's", 'Other'] }),
        f('Sales_Calls_Pain_Points', 'Pain points', 'textarea'),
        f('Current_Hiring_Practices', 'Current hiring practices', 'textarea'),
        f('Requested_Marketing_Materials', 'Requested marketing materials', 'bool'),
        f('Services_Interested_In', 'Services interested in', 'multi', { options: ['Virtual admin support', 'Coaching sessions from a cleaning business expert', 'Online marketing services'] }),
      ] },
      { title: 'Address', fields: [
        f('Billing_Street', 'Billing street'), f('Billing_City', 'Billing city'), f('Billing_State', 'Billing state'),
        f('Billing_Code', 'Billing ZIP'), f('Billing_Country', 'Billing country'),
        f('Shipping_Street', 'Shipping street'), f('Shipping_City', 'Shipping city'), f('Shipping_State', 'Shipping state'),
        f('Shipping_Code', 'Shipping ZIP'), f('Shipping_Country', 'Shipping country'),
      ] },
    ],
  },

  contacts: {
    label: 'Contacts', one: 'contact',
    nameKey: null, statusKey: null,
    sections: [
      { title: 'Contact information', fields: [
        f('First_Name', 'First name'),
        f('Last_Name', 'Last name'),
        f('Salutation', 'Salutation', 'pick', { options: ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.'] }),
        f('Title', 'Job title'),
        f('Email', 'Email', 'email'),
        f('Secondary_Email', 'Second email', 'email'),
        f('Phone', 'Phone', 'phone'),
        f('Other_Phone', 'Other phone', 'phone'),
        f('Timezone', 'Time zone', 'pick', { options: ['EST', 'CST', 'MST', 'PST'] }),
        f('Emergency_Contact_Method', 'Emergency contact method'),
        f('Offboarded', 'Offboarded?', 'bool'),
        f('Email_Opt_Out', 'Email opt out', 'bool'),
        f('Monthly_Check_In_Complete1', 'Do not survey?', 'bool'),
        f('Owner', 'Contact owner', 'owner'),
        f('Tag', 'Tags', 'tags'),
      ] },
      { title: 'Sales', fields: [
        f('Lead_Source', 'Lead source', 'pick', { options: ['Advertisement', 'Cold Call', 'Employee Referral', 'External Referral', 'Online Store', 'Partner', 'X (Twitter)', 'Facebook', 'Public Relations', 'Sales Email Alias', 'Seminar Partner', 'Internal Seminar', 'Trade Show', 'Web Download'] }),
        f('Estimated_Package_Amount', 'Estimated package amount', 'pick', { options: ['15', '20', '30', '40', '50', '60', '80', '100', '120', '140', '160'] }),
        f('Estimated_Dollar_Amount_Monthly', 'Estimated dollar amount - monthly', 'pick', { options: ['$720.00', '$959.00', '$1,430.00', '$1,893.00', '$2,279.00', '$2,642.00', '$3,395.00', '$4,119.00', '$4,939.00', '$5,760.00', '$6,349.00'] }),
        f('Set_Up_Fee', 'Set-up fee', 'pick', { options: ['Full', 'Half', 'Waived'] }),
        f('Monthly_Revenue_Business', 'Monthly revenue (business)', 'pick', { options: ['Under $10K', '$10K-$25K', '$25K+'] }),
        f('Sales_Calls_Pain_Points', 'Pain points', 'textarea'),
        f('Admin_Staff_Details', 'Admin staff details', 'textarea'),
        f('Previous_VA_Experience', 'Previous VA experience', 'textarea'),
        f('Current_Marketing_Strategies', 'Current marketing strategies', 'textarea'),
        f('Lead_Sources_Software', 'Lead sources & software', 'textarea'),
        f('Marketing_Needs_Wants', 'Marketing needs & wants', 'textarea'),
        f('Current_Hiring_Practices', 'Current hiring practices', 'textarea'),
      ] },
      { title: 'Notes', fields: [f('Description', 'Description', 'textarea')] },
      { title: 'Address', fields: [
        f('Mailing_Street', 'Mailing street'), f('Mailing_City', 'Mailing city'), f('Mailing_State', 'Mailing state'),
        f('Mailing_Zip', 'Mailing ZIP'), f('Mailing_Country', 'Mailing country'),
        f('Other_Street', 'Other street'), f('Other_City', 'Other city'), f('Other_State', 'Other state'),
        f('Other_Zip', 'Other ZIP'), f('Other_Country', 'Other country'),
      ] },
    ],
  },

  vas: {
    label: 'VAs', one: 'VA',
    nameKey: 'Name', statusKey: 'VA_Status', statuses: ['Active', 'On Deck', 'Offboarded', 'n/a'],
    sections: [
      { title: 'VA information', fields: [
        f('Name', 'Name', 'text', { required: true }),
        f('VA_Status', 'VA status', 'pick', { options: ['Active', 'On Deck', 'Offboarded', 'n/a'], hint: 'Active VAs can log in to this app and are checked in. Active and On Deck VAs can cover for others.' }),
        f('Email', 'Email', 'email', { hint: 'Active VAs log in with this email.' }),
        f('Phone', 'Phone', 'phone'),
        f('WhatsApp', 'WhatsApp', 'phone'),
        f('Location', 'Location'),
        f('Time_Zone', 'Time zone', 'pick', { options: ['EST', 'CST', 'MST', 'PST'] }),
        f('Availability', 'Availability', 'pick', { options: ['9am - 5pm', '8am - 5pm', '8:30am - 4:30pm', '8am - 4pm', '8:30am - 5pm', 'Open availability'] }),
        f('Type', 'Type', 'pick', { options: ['US-based', 'International', 'After-Hours Only'] }),
        f('VA_Company_Affiliation', 'VA company affiliation', 'pick', { options: ['InoVA Local', 'Closers'], hint: 'Only "InoVA Local" VAs are checked in.' }),
        f('After_Hours', 'After-hours', 'bool'),
        f('Start_Date', 'Start date', 'date'),
        f('Package_Hours', 'Package hours', 'int'),
        f('Birthday', 'Birthday'),
        f('Owner', 'VA owner', 'owner'),
        f('Tag', 'Tags', 'tags'),
      ] },
      { title: 'Slack', fields: [
        f('Slack_ID', 'Slack ID', 'text', { hint: "The VA's own Slack member ID, used to tag them." }),
        f('Slack_Management_ID', 'Slack management channel ID', 'text', { hint: "The ID of the VA's management channel." }),
      ] },
      { title: 'Pay', fields: [
        f('PayPal_Username_Email', 'PayPal username/email'),
        f('Date_of_Last_Rate_Increase', 'Date of last rate increase', 'date'),
        f('Compensation_Notes', 'Compensation notes', 'textarea'),
      ] },
      { title: 'Scores and check-ins', fields: [
        f('Keeper_Score', 'Keeper score', 'int'),
        f('Retention_Score', 'Retention score', 'int'),
        f('Warnings', 'Warnings', 'int'),
        f('Interested_in_more', 'Interested/eligible in more?', 'pick', { options: ['Yes', 'No', 'Eventually'] }),
        f('Monthly_Check_In_Completed', 'Monthly check-in completed?', 'bool'),
      ] },
      { title: 'Emergency contact and address', fields: [
        f('Emergency_Contact_Name', 'Emergency contact name'),
        f('Emergency_Contact_Phone', 'Emergency contact phone', 'phone'),
        f('Mailing_Address', 'Mailing address', 'textarea'),
      ] },
      { title: 'Referrals', fields: [
        f('Referred1', 'Referred?', 'bool'),
        f('Referred_By', 'Referred by', 'lookups', { to: 'vas', reverse: 'VAs referred' }),
      ] },
      { title: 'Notes and documents', fields: [
        f('VA_Notes', 'VA notes', 'textarea'),
        f('Resume', 'Resume', 'file'),
      ] },
    ],
  },

  applicants: {
    label: 'Applicants', one: 'applicant',
    nameKey: null, statusKey: 'Applicant_Status', statuses: [...STEPS, ...CLOSED],
    sections: [
      { title: 'Applicant', fields: [
        f('Name', 'First name', 'text', { required: true }),
        f('Last_Name', 'Last name'),
        f('Applicant_Status', 'Hiring step', 'pick', { options: [...STEPS, ...CLOSED] }),
        f('Declined_Reason', 'Why declined', 'text', { hint: 'Only needed when the step is Declined.' }),
        f('Email', 'Email', 'email'),
        f('Phone', 'Phone', 'phone'),
        f('Location', 'Location'),
        f('Time_zone', 'Time zone', 'pick', { options: ['EST', 'CST', 'MST', 'PST'] }),
        f('Availability', 'Availability'),
      ] },
      { title: 'Experience', fields: [
        f('Year_of_admin_experience', 'Years of admin experience'),
        f('Prev_service_industry_experience1', 'Previous service industry experience'),
        f('Cleaning_industry_experience', 'Cleaning industry experience', 'bool'),
        f('Systems_Tools', 'Systems and tools'),
        f('Languages', 'Languages'),
        f('VA_Bio', 'Bio', 'textarea'),
        f('Resume', 'Resume', 'file'),
      ] },
      { title: 'Resume score', score: 'resume', fields: [
        ...RESUME_PARTS.map(([k, label, max]) => f(k, `${label} (0-${max})`, 'num', { min: 0, max, step: 0.5 })),
        f('Resume_Summary', 'Summary', 'textarea', { hint: 'A short summary of the applicant, for example from Claude.' }),
      ] },
      { title: 'Screening call score', score: 'call', fields: [
        ...CALL_AREAS.map(([k, label], i) => f(k, `${label} (1-5)${i < CALL_REQUIRED ? '' : ', optional'}`, 'int', { min: 1, max: 5, hint: CALL_HINTS[k] })),
        f('pre_Additional_Comments', 'Notes from the call', 'textarea'),
      ] },
      { title: 'Offer checklist', offer: true, fields: OFFER_ITEMS.map(([k, label]) => f(k, label, 'bool')) },
    ],
  },
};

// ---- Admin changes to the fields (Settings > Fields) ----
//
// Each module's changes are one JSON row in field_layouts:
//   { sections: [{ id, title, keys: [field keys in order] }], over: { key: { label, hint, options } },
//     custom: { key: { label, type, hint, options } }, hidden: [keys], used: [every custom key ever made], next }
// Built-in sections have their built-in title as id. Custom fields are kept in record.data under their own key
// (cf_...), which never changes, so renaming a label never moves data. Built-in fields or sections that the row
// doesn't mention (for example ones added to BASE later) stay where BASE puts them.

// Fields the app's code reads by key: admins can only change their label and help text (not hide, delete,
// change choices or move them to another section). Lookups, owners and files are protected too.
const PROTECTED = {
  clients: ['Account_Name', 'Status', 'Contact', 'Email', 'Phone', 'Location', 'Package_Hours', 'Shift', 'Timezone', 'Owner', 'Referred_by', 'Contract'],
  contacts: ['First_Name', 'Last_Name', 'Title', 'Email', 'Secondary_Email', 'Phone', 'Location', 'Offboarded', 'Owner'],
  vas: ['Name', 'VA_Status', 'Email', 'Phone', 'Location', 'Time_Zone', 'Availability', 'VA_Company_Affiliation', 'Slack_ID', 'Slack_Management_ID', 'Owner', 'Referred_By', 'Resume'],
  applicants: ['Name', 'Last_Name', 'Applicant_Status', 'Declined_Reason', 'Email', 'Phone', 'Location', 'Time_zone', 'Availability', 'Resume',
    ...RESUME_PARTS.map(([k]) => k), ...CALL_AREAS.map(([k]) => k), ...OFFER_ITEMS.map(([k]) => k)],
};
const PROTECTED_TYPES = ['lookup', 'lookups', 'owner', 'file'];

// The field types an admin can add, with their names on the Fields page.
export const CUSTOM_TYPES = [['text', 'Text'], ['textarea', 'Long text'], ['num', 'Number'], ['date', 'Date'], ['pick', 'Pick list (one choice)'],
  ['multi', 'Checkbox group (several choices)'], ['bool', 'Yes/no checkbox'], ['email', 'Email'], ['phone', 'Phone'], ['url', 'Link (web address)']];

const baseField = (key, k) => BASE[key].sections.flatMap((s) => s.fields).find((x) => x.key === k) || null;

export function isProtected(key, k) {
  const b = baseField(key, k);
  return Boolean(b && (PROTECTED[key].includes(k) || PROTECTED_TYPES.includes(b.type)));
}

// A module's full layout: every field is in exactly one section or in `hidden`.
export function normalLayout(key, L = {}) {
  const base = BASE[key];
  const custom = L.custom || {};
  const live = new Set([...base.sections.flatMap((s) => s.fields.map((x) => x.key)), ...Object.keys(custom)]);
  const hidden = [...new Set(L.hidden || [])].filter((k) => live.has(k) && !isProtected(key, k));
  const placed = new Set(hidden);
  const sections = [];
  for (const s of L.sections || []) {
    if (!s || !s.id || sections.some((t) => t.id === s.id)) continue;
    const keys = (s.keys || []).filter((k) => live.has(k) && !placed.has(k));
    keys.forEach((k) => placed.add(k));
    sections.push({ id: String(s.id), title: String(s.title || s.id), keys });
  }
  for (const s of base.sections) {
    let t = sections.find((x) => x.id === s.title);
    if (!t) { t = { id: s.title, title: s.title, keys: [] }; sections.push(t); }
    for (const x of s.fields) if (!placed.has(x.key)) { t.keys.push(x.key); placed.add(x.key); }
  }
  for (const k of Object.keys(custom)) if (!placed.has(k)) { sections[0].keys.push(k); placed.add(k); }
  return { sections, over: L.over || {}, custom, hidden, used: L.used || [], next: L.next || 1 };
}

// One field as the app uses it: the built-in one (or the custom one) with the admin's label, help text and choices.
export function fieldOf(key, N, k) {
  const b = baseField(key, k);
  const c = N.custom[k];
  if (!b && !c) return null;
  const x = b ? { ...b } : { key: k, label: c.label, type: c.type, custom: true, ...(c.hint ? { hint: c.hint } : {}), ...(c.type === 'pick' || c.type === 'multi' ? { options: [...(c.options || [])] } : {}) };
  const o = N.over[k] || {};
  if (o.label) x.label = o.label;
  if (o.hint !== undefined) { if (o.hint) x.hint = o.hint; else delete x.hint; }
  if (o.options && (x.type === 'pick' || x.type === 'multi') && !isProtected(key, k)) x.options = [...o.options];
  if (isProtected(key, k)) x.locked = true;
  return x;
}

// The modules as the app uses them (BASE with the admin's changes). Rebuilt by loadFieldLayouts.
export const MODULES = {};
function build(rows) {
  for (const key of Object.keys(BASE)) {
    let L = {};
    try { L = JSON.parse(rows.find((r) => r.module === key)?.data || '{}'); } catch { L = {}; }
    const N = normalLayout(key, L);
    const baseSec = (id) => BASE[key].sections.find((s) => s.title === id) || {};
    MODULES[key] = {
      ...BASE[key],
      layout: N,
      sections: N.sections.map((s) => {
        const { fields: _f, title: _t, ...rest } = baseSec(s.id);
        return { ...rest, id: s.id, title: s.title, fields: s.keys.map((k) => fieldOf(key, N, k)) };
      }),
      hiddenFields: N.hidden.map((k) => fieldOf(key, N, k)),
    };
  }
}
build([]);

// Reads the admins' field changes (one small read) and rebuilds MODULES when they changed. Called at the start of
// each request that shows or saves records. If the table isn't there yet, the built-in fields are used.
let loaded = '[]';
export async function loadFieldLayouts(env) {
  let rows = [];
  try { rows = (await env.DB.prepare('SELECT module, data FROM field_layouts').all()).results; } catch { rows = []; }
  const text = JSON.stringify(rows);
  if (text !== loaded) { loaded = text; build(rows); }
}

// Every field, also hidden ones (for the history, field types and Wufoo).
export const allFields = (key) => [...MODULES[key].sections.flatMap((s) => s.fields), ...MODULES[key].hiddenFields];

// The fields typed in on the edit form (files are added on the record page instead). Hidden fields are not on it
// (they keep their values).
export const formFields = (key) => MODULES[key].sections.flatMap((s) => s.fields).filter((x) => x.type !== 'file');

// A record's name and status from its field values.
export function nameOf(key, data) {
  if (key === 'contacts') return [data.First_Name, data.Last_Name].filter(Boolean).join(' ').trim() || data.Email || 'No name';
  if (key === 'applicants') return [data.Name, data.Last_Name].filter(Boolean).join(' ').trim() || data.Email || 'No name';
  return (data[MODULES[key].nameKey] || '').trim() || 'No name';
}

export function statusOf(key, data) {
  if (key === 'contacts') return data.Offboarded ? 'Offboarded' : 'Current';
  if (key === 'clients') return data.Status || 'Current';
  if (key === 'applicants') return data.Applicant_Status || 'New application';
  return data.VA_Status || 'n/a';
}

// The text the global search looks in (records.search, see search.js): the name, emails, phone, place, title and
// every field added on Settings > Fields (not hidden ones, not yes/no boxes), plus each phone number as digits only,
// so "(512) 555" finds "512-555-0100". Tag names and a contact's client are added when searching.
// When this changes, raise SEARCH_VERSION in search.js so saved records get the new text.
export function searchOf(key, data, name) {
  const L = MODULES[key].layout;
  const custom = Object.entries(L.custom).filter(([k, c]) => c.type !== 'bool' && !L.hidden.includes(k)).map(([k]) => data[k]);
  const values = [name, data.Email, data.Secondary_Email, data.Phone, data.Location, data.Title, ...custom].flat()
    .filter((v) => (typeof v === 'string' && v) || typeof v === 'number').map(String);
  const digits = allFields(key).filter((x) => x.type === 'phone').map((x) => (typeof data[x.key] === 'string' ? data[x.key].replace(/\D/g, '') : ''))
    .filter((v) => v.length >= 3);
  return [...values, ...digits].join(' ').toLowerCase();
}

// Plain-text version of a value, for the change history.
export function plainValue(field, v, names = new Map()) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '';
  if (field?.type === 'bool') return v ? 'Yes' : 'No';
  if (field?.type === 'lookup') return names.get(Number(v)) || `#${v}`;
  if (field?.type === 'lookups') return v.map((id) => names.get(Number(id)) || `#${id}`).join(', ');
  if (field?.type === 'money') return `$${Number(v).toLocaleString('en-US')}`;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
