/*
 * The view the dev harness binds: columns and records, chosen for the edges.
 *
 * **This is not `demo/records.json`, and the difference is deliberate.** That
 * one is the hub's demo fixture — it exists to look like a working control on a
 * public page, so it is tidy, short and fits on one screen. This one exists to
 * break things:
 *
 *   - **twelve records**, so a page size of five gives three pages. The single
 *     page the hub's harness supplies is why every dataset control in the
 *     catalogue is stuck at `fidelity: "limited"`, and it is the reason paging
 *     code has never been exercised anywhere before this file.
 *   - **a hidden column and columns out of order**, because `isHidden` and
 *     `order` are the maker's decisions in the view designer and a table that
 *     ignores either looks broken to whoever set them.
 *   - **a non-sortable column**, which a real view has and a hand-written
 *     fixture never does.
 *   - **a null value and an empty string in the same column**, the two that
 *     catch a cell renderer treating falsy as empty, and **a record with no
 *     name at all** — the row that is a real record and looks like a rendering
 *     failure.
 *   - **a name long enough to overflow**, because column widths are decided by
 *     `visualSizeFactor` and nobody finds out until a customer has a long one.
 *   - **a URL column carrying six things that are not a URL**, because this
 *     control hands that value to `context.navigation.openUrl` and the value
 *     came off a record anybody with write access can edit. `javascript:`,
 *     `data:` and `ftp:` are there to be refused; a relative path and an empty
 *     string are there because they are ordinary and must not throw; and one
 *     value is padded with spaces because a copy-pasted URL usually is.
 *
 * Loaded by `harness.html` in a browser and by `smoke.js` in Node, so it
 * assigns both ways and depends on neither.
 */

(function (root, factory) {
    'use strict';

    var fixture = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = fixture;
    }

    if (root) {
        root.__pcfFixture = fixture;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    return {
        targetEntityType: 'account',
        title: 'Active Accounts',

        /*
         * `order` is not the array order, on purpose: a view's columns arrive
         * in whatever order the platform hands them over and carry their
         * intended position in `order`. A control that renders them as supplied
         * looks correct against a fixture that agrees with itself and wrong
         * against a real view.
         */
        columns: [
            {
                name: 'accountnumber',
                displayName: 'Account number',
                dataType: 'SingleLine.Text',
                alias: 'accountnumber',
                order: 1,
                visualSizeFactor: 120,
            },
            {
                name: 'name',
                displayName: 'Account name',
                dataType: 'SingleLine.Text',
                alias: 'name',
                order: 0,
                visualSizeFactor: 200,
                isPrimary: true,
            },
            {
                name: 'statecode',
                displayName: 'Status',
                dataType: 'OptionSet',
                alias: 'statecode',
                order: 3,
                visualSizeFactor: 90,
            },
            {
                name: 'primarycontactname',
                displayName: 'Primary contact',
                dataType: 'SingleLine.Text',
                alias: 'primarycontactname',
                order: 2,
                visualSizeFactor: 150,
                // A computed or joined column a view can carry and a user
                // cannot order by. Its absence from a fixture is why a control
                // that renders every header as a sort button ships that way.
                disableSorting: true,
            },
            {
                name: 'ownerid',
                displayName: 'Owner',
                dataType: 'Lookup.Simple',
                alias: 'ownerid',
                order: 4,
                visualSizeFactor: 120,
                // Present in the view and not to be drawn. A table that ignores
                // this shows a column the maker deliberately turned off.
                isHidden: true,
            },

            /*
             * The mapped role, and **the `alias` deliberately differs from the
             * `name`.**
             *
             * That is the whole point of it being here. A `property-set` role is
             * found on the column by `alias` and read off the record by `name`,
             * and a fixture where the two are the same string passes whichever
             * way round the control does it — which is exactly how that bug
             * reached production in `pcf-tag-list`. With these two different,
             * getting it backwards renders no Launch button at all and the
             * smoke suite says so.
             */
            {
                name: 'websiteurl',
                displayName: 'Website',
                dataType: 'SingleLine.URL',
                alias: 'urlField',
                order: 5,
                visualSizeFactor: 180,
            },
        ],

        records: [
            { id: 'a01', values: { name: 'Fabrikam Manufacturing', accountnumber: 'ACC-1042', primarycontactname: 'Dana Whitfield', statecode: 'Active', ownerid: 'Sam Vaziri', websiteurl: 'https://fabrikam.example.com' } },
            { id: 'a02', values: { name: 'Contoso Logistics', accountnumber: 'ACC-1087', primarycontactname: 'Ravi Menon', statecode: 'Active', ownerid: 'Sam Vaziri', websiteurl: 'http://contoso.example.com/logistics' } },
            { id: 'a03', values: { name: 'Northwind Traders', accountnumber: 'ACC-1103', primarycontactname: 'Erin Boyle', statecode: 'Active', ownerid: 'Jo Park', websiteurl: 'https://northwind.example.com/traders?ref=view' } },
            { id: 'a04', values: { name: 'Adventure Works Cycles', accountnumber: 'ACC-1155', primarycontactname: 'Marcus Feld', statecode: 'Active', ownerid: 'Jo Park', websiteurl: '' } },
            { id: 'a05', values: { name: 'Litware Consulting', accountnumber: 'ACC-1178', primarycontactname: 'Priya Raman', statecode: 'Inactive', ownerid: 'Jo Park', websiteurl: null } },
            { id: 'a06', values: { name: 'Tailspin Toys', accountnumber: 'ACC-1201', primarycontactname: 'Owen Brackett', statecode: 'Active', ownerid: 'Sam Vaziri', websiteurl: 'javascript:alert(document.cookie)' } },
            { id: 'a07', values: { name: 'Proseware Systems', accountnumber: 'ACC-1233', primarycontactname: 'Alice Nakamura', statecode: 'Active', ownerid: 'Jo Park', websiteurl: '/main.aspx?etn=account&pagetype=entityrecord' } },
            { id: 'a08', values: { name: 'Wingtip Analytics', accountnumber: 'ACC-1260', primarycontactname: 'Tomas Ehrlich', statecode: 'Active', ownerid: 'Sam Vaziri', websiteurl: 'HTTPS://Wingtip.Example.com/Analytics' } },

            // The edges start here.

            // A column with no value at all, which is not the same as one with
            // an empty string — and both reach `getFormattedValue`.
            // And no name at all, which is what a real view surfaced: sorted by
            // name, every unnamed record lands at the top, so the first thing
            // anybody sees is a run of blank rows with working commands beside
            // them. The primary column is the row's identity and an empty one
            // has to say so.
            { id: 'a09', values: { name: '', accountnumber: null, primarycontactname: '', statecode: 'Active', ownerid: 'Jo Park', websiteurl: '  https://blueyonder.example.com  ' } },

            // Long enough to overflow whatever width `visualSizeFactor` bought.
            { id: 'a10', values: { name: 'Consolidated Messenger Intercontinental Freight and Warehousing', accountnumber: 'ACC-1288', primarycontactname: 'Margarethe Kowalczyk-Fitzgerald', statecode: 'Active', ownerid: 'Sam Vaziri', websiteurl: 'data:text/html,<script>alert(1)</script>' } },

            // Leading punctuation and a lowercase start: the two that show a
            // sort comparing raw strings rather than formatted values.
            { id: 'a11', values: { name: '(pending) Woodgrove Bank', accountnumber: 'ACC-0007', primarycontactname: 'Ines Duarte', statecode: 'Inactive', ownerid: 'Jo Park', websiteurl: 'https://woodgrove.example.com' } },
            { id: 'a12', values: { name: 'école Numérique', accountnumber: 'ACC-1310', primarycontactname: 'LucRousseau', statecode: 'Active', ownerid: 'Sam Vaziri', websiteurl: 'ftp://files.example.com/ecole' } },
        ],
    };
});
