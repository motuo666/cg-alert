Current runner version: '2.328.0'
Runner Image Provisioner
Operating System
Runner Image
GITHUB_TOKEN Permissions
Secret source: Actions
Prepare workflow directory
Prepare all required actions
Getting action download info
Download action repository 'actions/checkout@v4' (SHA:08eba0b27e820071cde6df949e0beb9ba4906955)
Download action repository 'actions/setup-node@v4' (SHA:49933ea5288caeca8642d1e84afbd3f7d6820020)
Complete job name: Local chain test (DRY)
1s
Run actions/checkout@v4
Syncing repository: motuo666/cg-alert
Getting Git version info
Temporarily overriding HOME='/home/runner/work/_temp/22ee0ef6-db03-4a0c-91c3-7ba533bf1cd9' before making global git config changes
Adding repository directory to the temporary git global config as a safe directory
/usr/bin/git config --global --add safe.directory /home/runner/work/cg-alert/cg-alert
Deleting the contents of '/home/runner/work/cg-alert/cg-alert'
Initializing the repository
Disabling automatic garbage collection
Setting up auth
Fetching the repository
Determining the checkout info
/usr/bin/git sparse-checkout disable
/usr/bin/git config --local --unset-all extensions.worktreeConfig
Checking out the ref
/usr/bin/git log -1 --format=%H
b58a40ded240ad8da28733883174ec6bee4bf895
3s
Run actions/setup-node@v4
Found in cache @ /opt/hostedtoolcache/node/18.20.8/x64
Environment details
3m 17s
Run node scripts/self_test.js
✅ demo evidence ready
▶ Discover Public Contacts
discover_contacts: added=0, leads_total=19
✅ Promote Intakes PASS
▶ Vendor Catalog Build
vendor_catalog: vendors=2
✅ Vendor Catalog Build PASS
▶ Updates Build
updates: built 2 items (30d)
✅ Updates Build PASS
▶ Categories Build
build_categories: tags=1, vendors=1
✅ Categories Build PASS
ℹ no enterprise customer yet → skip customer feeds
▶ Upsell Capacity
upsell: none
✅ Upsell Capacity PASS
ℹ skip scale watch (no scripts/scale_watch.js)
✅ exists: vendors/index.html
❌ SELF TEST FAILED — 按上面的 ❌ 项逐个排查（脚本缺失/路径错误/脚本异常）
✅ exists: updates/index.html
✅ exists: updates/rss.xml
✅ exists: api/vendors.json
✅ exists: sitemap-vendors.xml
====================
Error: Process completed with exit code 1.
0s
0s
Post job cleanup.
/usr/bin/git version
git version 2.51.0
Temporarily overriding HOME='/home/runner/work/_temp/cddc8a56-5105-457e-b7a1-d5f395604a3b' before making global git config changes
Adding repository directory to the temporary git global config as a safe directory
/usr/bin/git config --global --add safe.directory /home/runner/work/cg-alert/cg-alert
/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
http.https://github.com/.extraheader
/usr/bin/git config --local --unset-all http.https://github.com/.extraheader
/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
0s
Cleaning up orphan processes
