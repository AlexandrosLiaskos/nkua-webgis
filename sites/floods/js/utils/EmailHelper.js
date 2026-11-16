/**
 * EmailHelper - Email templates and XLSX download utilities
 *
 * Handles email composition for data submissions, bug reports,
 * and feature suggestions. Also handles XLSX template downloads.
 */

class EmailHelper {
    constructor() {
        this.recipients = 'alexliaskos@geol.uoa.gr,evelpidou@geol.uoa.gr';
    }

    downloadXLSXTemplate() {
        const link = document.createElement('a');
        link.setAttribute('href', '/floods/templates/floods-data-template.xlsx');
        link.setAttribute('download', 'floods-data-template.xlsx');
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    openSubmitDataEmail() {
        const subject = encodeURIComponent('Historic Floods Data Submission');

        const body = encodeURIComponent(
`Dear Historic Floods Team,

Please find attached flood data for inclusion in the Historic Floods database.

SUBMISSION DETAILS
==================
Region/Country: [Please specify]
Time Period: [e.g., 1900-2020]
Number of Records: [Please specify]

CONTRIBUTORS
============
Name(s): [Your name and co-contributors]
Affiliation: [University/Institution/Organization]
Contact Email: [Your email address]

ADDITIONAL NOTES
================
[Any additional information about the data, sources, or methodology]

Best regards,
[Your name]

---
Please attach your completed XLSX template or a CSV file with matching headers.
Download the template at: https://evelpidou.geo.nkua.cloud/floods/templates/floods-data-template.xlsx`
        );

        window.location.href = `mailto:${this.recipients}?subject=${subject}&body=${body}`;
    }

    openReportBugEmail() {
        const subject = encodeURIComponent('Historic Floods - Issue Report');

        const body = encodeURIComponent(
`Dear Historic Floods Team,

I would like to report an issue with the website.

ISSUE DETAILS
=============
Type: [Bug / Data Error]

Description:
[Please describe the problem you encountered]

Where it happened:
[e.g., Map, Filters, Query Builder, specific flood event #123]

Best regards,
[Your name]`
        );

        window.location.href = `mailto:${this.recipients}?subject=${subject}&body=${body}`;
    }

    openSuggestionEmail() {
        const subject = encodeURIComponent('Historic Floods - Feature Suggestion');

        const body = encodeURIComponent(
`Dear Historic Floods Team,

I have a suggestion for the Historic Floods website.

SUGGESTION
==========
Type: [New Feature / Improvement / Data Addition]

Description:
[Please describe your idea]

Why it would be useful:
[How would this help users?]

Best regards,
[Your name]`
        );

        window.location.href = `mailto:${this.recipients}?subject=${subject}&body=${body}`;
    }
}

export default EmailHelper;
