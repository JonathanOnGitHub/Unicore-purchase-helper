const { chromium } = require('playwright');
const fs = require('fs');

/**
 * Auto Purchase Order Script for UniCore Purchasing System
 * 
 * Based on documentation from:
 * - SCM_SSP_How to Create a Catalogue Requisition.docx
 * - SCM_SSP_How to Create a Non-Catalogue Requisition.docx
 * - Quick checklist for non-catalogue requisitions.docx
 */

function getQuoteInfo(amount) {
  let category, quoteText, fabNote;
  if (amount < 5000) {
    category = 'Small order (under £5,000)';
    quoteText = 'Obtain 1 written quote/price from suitably qualified supplier';
    fabNote = 'FAB approval not required';
  } else if (amount < 25000) {
    category = 'Medium order (£5,000 - £24,999.99)';
    quoteText =
      'Obtain 3 written formal quotations from suitably qualified suppliers';
    fabNote = 'FAB approval not required';
  } else {
    category = 'Large order (£25,000+)';
    quoteText =
      'Contact Procurement Team for assistance - minimum 3 quotes required';
    fabNote = 'FAB approval REQUIRED for orders £20,000+';
  }
  return { category, quoteText, fabNote };
}

async function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (response) => {
      resolve(response !== undefined ? response : '');
    });
  });
}

async function main() {
  console.log('=== Playwright Purchase Order Automator ===\n');

  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const orderAmount = parseFloat(
    await askQuestion(rl, 'Enter order amount (before VAT): £')
  );

  const orderDescription = await askQuestion(rl, 'Enter item description: ');

  const supplierName = await askQuestion(rl, 'Enter supplier name: ');

  const { category, quoteText, fabNote } = getQuoteInfo(orderAmount);

  console.log(`\nOrder category: ${category}`);
  console.log(`Quote requirement: ${quoteText}`);
  console.log(`FAB approval: ${fabNote}`);

  let fabApproval = false;
  if (fabNote.includes('REQUIRED')) {
    const response = await askQuestion(rl, 'Have you completed FAB approval? (y/n): ');
    const answer = (response || '').toString().trim().toLowerCase();
    if (answer !== 'y') {
      console.error('ERROR: FAB approval required for orders £20,000+');
      process.exit(1);
    }
    fabApproval = true;
  }

  const projectCodes = [
    'A12673 (Claire)',
    'RA26F4',
    'A92626 (Research Support Fund - Dr J Burley)',
    'A126E4 (Research Students - Dr J Burley)',
    'AtlasBio RC26AF',
    'SR2616 (Escubed project)',
    'K12603 (HTS printing spin-out)',
    'RS26B7 (Rebecca)'
  ];

  const projectCode = await askQuestion(rl, `
Select project code:
${projectCodes.join('\n')}
Enter code: `);

// Validate project code has charge account configured
const hasValidCode = projectCodes.some(code => code.startsWith(projectCode));
if (!hasValidCode) {
  console.error(`\n❌ Invalid project code: ${projectCode}`);
  console.error('Please enter a valid project code from the list above.');
  process.exit(1);
}

console.log(`\n⚠️  IMPORTANT: Ensure your Oracle Purchasing user preferences have a `);
console.log('   default "Charge Account" (User Preferred Account) configured for this project code.');
console.log('   This is required for the accounting flexfield to generate on requisition submission.');
console.log('   See "Account_codes" file in ~/Documents/Nottingham/ for your project code mappings.');
console.log('   Press Enter to continue or Ctrl+C to cancel...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('\n[1/5] Navigating to UniCore purchasing system...');
    await page.goto('https://fa-evyf-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/faces/FuseWelcome?', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Handle potential Azure AD SSO login redirect
    const url = page.url();
    let ssoDetected = false;
    if (url.includes('microsoftonline.com') || url.includes('login.microsoft.com')) {
      console.log('Azure AD SSO detected - please complete authentication in the browser...');
      ssoDetected = true;
    }
    
    // Wait for navigation to stabilize on Oracle Cloud domain
    if (ssoDetected) {
      console.log('Waiting for SSO authentication to complete...');
      // Wait until we're on the Oracle Cloud domain with no further redirects
      await page.waitForFunction(
        (url) => {
          try {
            return url.includes('fa-evyf-saasfaprod1.fa.ocs.oraclecloud.com') && 
                   !url.includes('microsoftonline.com') && 
                   !url.includes('login.microsoft.com');
          } catch(e) {
            return false;
          }
        },
        {},
        { timeout: 120000 }
      );
    } else {
      // No SSO detected - wait for username field or post-login element
      try {
        await page.waitForSelector('input[name="username"]', { timeout: 15000 });
      } catch(e) {
        await page.waitForSelector('body', { timeout: 15000 });
        console.log('Login page loaded - please complete authentication manually');
      }
    }
    console.log('Please complete login manually...');
    await page.waitForTimeout(10000);
    
    // Additional wait for page to fully settle
    await page.waitForLoadState('networkidle');

    console.log('\n[2/5] Navigating to create new requisition...');
    // Try clicking Create Requisition, handle potential SSO re-prompt
    let requisitionClicked = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.click('text=Create Requisition');
        await page.waitForSelector('form[action*="create"]', { timeout: 15000 });
        requisitionClicked = true;
        break;
      } catch(e) {
        console.log(`Attempt ${attempt + 1}: Redirect detected, re-authenticating...`);
        // Wait for SSO to complete
        try {
          await page.waitForFunction(
            (url) => {
              try {
                return url.includes('fa-evyf-saasfaprod1.fa.ocs.oraclecloud.com') && 
                       !url.includes('microsoftonline.com') && 
                       !url.includes('login.microsoft.com');
              } catch(e) {
                return false;
              }
            },
            {},
            { timeout: 120000 }
          );
        } catch(e) {
          console.log('Timeout waiting for SSO completion, trying again...');
        }
      }
    }
    if (!requisitionClicked) {
      console.error('Failed to navigate to requisition after 3 attempts');
      process.exit(1);
    }

    console.log('\n[3/5] Filling requisition form...');
    await page.fill('input[name="description"]', orderDescription);
    await page.fill('input[name="supplier"]', supplierName);
    await page.fill('input[name="amount"]', orderAmount.toString());
    await page.selectOption('select[name="projectCode"]', projectCode);

    console.log('\n[4/5] Attaching quotes...');
    if (orderAmount < 5000) {
      const quotePath = await askQuestion(rl, 'Enter path to quote document: ');
      await page.setInputFiles('input[name="quote1"]', quotePath);
    } else if (orderAmount < 25000) {
      for (let i = 1; i <= 3; i++) {
        const quotePath = await askQuestion(rl, `Enter path to quote ${i} document: `);
        await page.setInputFiles(`input[name="quote${i}"]`, quotePath);
      }
    } else {
      console.log(
        'For large orders, procurement team handles quotes during FAB process'
      );
    }

    const justification = await askQuestion(rl, 'Enter justification (required for non-catalogue items): ');
    await page.fill('textarea[name="justification"]', justification);

    console.log('\n[5/5] Submitting requisition...');
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Requisition submitted', { timeout: 15000 });

    console.log('\n✅ Requisition successfully submitted!');
    console.log('   - Reference number: Displayed on confirmation screen');
    console.log('   - Project code:', projectCode);
    console.log('   - FAB approval:', fabApproval ? 'Completed' : 'Not required');
    console.log('   ⚠️  Verify charge account was generated on the confirmation screen');
    console.log('      (POR-2010280 error means the charge account flexfield is missing)');

    const html = await page.content();
    fs.writeFileSync(
      `po_submission_${Date.now()}.html`,
      html
    );
    console.log('\n✅ HTML session saved for your records');

  } catch (error) {
    console.error('\n❌ Error during automation:', error.message);
    try { await page.screenshot({ path: 'po_error.png' }); } catch(e) {}
    console.log('   Screenshot saved as po_error.png');
  } finally {
    await browser.close();
    rl.close();
  }
}

main().catch(console.error);