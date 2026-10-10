// The fields of clients, client contacts, VAs and applicants, grouped into sections. The record pages, the edit
// forms and the copy from Zoho CRM all use this list. Each field's key is its Zoho CRM API name, so the copy from
// Zoho knows where each value goes (fields that are new in the app have new names). To add a field, add one line
// to a section.
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

// Applicant Status values in Zoho CRM and the step each one becomes (the training modules all become
// "In training"). Rejected applicants are not copied.
const ZOHO_STEPS = {
  '1. Form Submitted': 'New application',
  '2. Scheduling Email Sent': 'Screening call scheduled',
  '3. Formal Screening Scheduled': 'Screening call scheduled',
  '4. Formal Screening Completed': 'Screening call done',
  '5. Casual Hiring Scheduled': 'Screening call done',
  '6. Casual Hiring Completed': 'Screening call done',
  '7. Pending Offer & Hiring Material': 'Offer sent',
  '15. Training Completed': 'Training done',
  '16. Scheduled Final Interview': 'Training done',
  '17. Completed Final Interview': 'Training done',
  'Hired/Archived': 'Hired',
  'Ghosted by applicant': 'Ghosted',
  'Video Interview Invite Sent': 'Ghosted',
  Rejected: 'Declined',
};
export const zohoStep = (status) => ZOHO_STEPS[status] || (/^(8|9|1[0-4])\. Module/.test(status || '') ? 'In training' : 'New application');

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

export const MODULES = {
  clients: {
    label: 'Clients', one: 'client', zoho: 'Accounts', zohoTab: 'Accounts',
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
    label: 'Contacts', one: 'contact', zoho: 'Contacts', zohoTab: 'Contacts',
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
    label: 'VAs', one: 'VA', zoho: 'Virtual_Assistants', zohoTab: 'CustomModule1',
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
    label: 'Applicants', one: 'applicant', zoho: 'Applicants', zohoTab: 'CustomModule3',
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
      { title: 'Offer checklist', fields: OFFER_ITEMS.map(([k, label]) => f(k, label, 'bool')) },
    ],
  },
};

export const allFields = (key) => MODULES[key].sections.flatMap((s) => s.fields);

// The fields typed in on the edit form (files are added on the record page instead).
export const formFields = (key) => allFields(key).filter((x) => x.type !== 'file');

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

// The text searched on the list pages.
export const searchOf = (key, data, name) =>
  [name, data.Email, data.Secondary_Email, data.Phone, data.Location, data.Title].filter(Boolean).join(' ').toLowerCase();

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
