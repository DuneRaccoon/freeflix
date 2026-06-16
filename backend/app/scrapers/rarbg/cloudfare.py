import asyncio
import random
from loguru import logger
from playwright.async_api import async_playwright, TimeoutError

class CloudflareBypass:
    """Class to handle Cloudflare-protected sites using Playwright"""
    
    def __init__(self):
        self.browser = None
        self.context = None
        self.page = None
        self.is_initialized = False
        self.last_page_content = None
        
    async def initialize(self):
        """Initialize the browser with anti-detection settings"""
        if self.is_initialized:
            return True
            
        try:
            self.playwright = await async_playwright().start()
            
            # Launch browser with specific configuration for Cloudflare bypass
            self.browser = await self.playwright.chromium.launch(
                headless=False,  # Set to False initially to debug Cloudflare challenges
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-site-isolation-trials',
                    '--disable-web-security',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ]
            )
            
            # Create context with specific options to avoid Cloudflare detection
            self.context = await self.browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                java_script_enabled=True,
                locale="en-US",
                timezone_id="America/New_York",
                has_touch=False,
                permissions=["geolocation"],
                color_scheme="light",
                device_scale_factor=1.0,
                is_mobile=False,
            )
            
            # Add extra browser properties to avoid Cloudflare detection
            await self.context.add_init_script("""
                // Override properties that Cloudflare checks
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false
                });
                
                // Add language strings
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });
                
                // Modify navigator vendor
                Object.defineProperty(navigator, 'vendor', {
                    get: () => 'Google Inc.'
                });
                
                // Add specific permissions that Cloudflare might check
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' || 
                    parameters.name === 'geolocation' || 
                    parameters.name === 'midi' || 
                    parameters.name === 'camera' || 
                    parameters.name === 'microphone' || 
                    parameters.name === 'background-sync' || 
                    parameters.name === 'persistent-storage'
                ) 
                    ? Promise.resolve({state: 'granted'}) 
                    : originalQuery(parameters);
                
                // Add Chrome-specific properties
                window.chrome = {
                    runtime: {}
                };
                
                // Add fake plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => {
                        return [
                            {
                                name: 'Chrome PDF Plugin',
                                description: 'Portable Document Format',
                                filename: 'internal-pdf-viewer',
                                length: 1,
                                item: () => null
                            },
                            {
                                name: 'Chrome PDF Viewer',
                                description: '',
                                filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                                length: 1,
                                item: () => null
                            },
                            {
                                name: 'Native Client',
                                description: '',
                                filename: 'internal-nacl-plugin',
                                length: 2,
                                item: () => null
                            }
                        ]
                    }
                });
            """)
            
            self.page = await self.context.new_page()
            
            # Set stealth behavior on page level
            await self.page.evaluate("""
                // Add getters and complex properties that Cloudflare may check
                window.navigator.connection = {
                    effectiveType: '4g',
                    rtt: 100,
                    downlink: 10,
                    saveData: false
                };
                
                // Add hardware concurrency
                Object.defineProperty(navigator, 'hardwareConcurrency', {
                    get: () => 8
                });
                
                // Add device memory (Chrome-only feature)
                Object.defineProperty(navigator, 'deviceMemory', {
                    get: () => 8
                });
                
                // Define max touch points
                Object.defineProperty(navigator, 'maxTouchPoints', {
                    get: () => 1
                });
            """)
            
            # Simulate human-like interactions
            await self.random_mouse_movements()
            
            self.is_initialized = True
            logger.info("Browser initialized with anti-Cloudflare configurations")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize browser: {e}")
            await self.cleanup()
            return False
    
    async def random_mouse_movements(self):
        """Perform random mouse movements to appear more human-like"""
        width, height = 1920, 1080
        for _ in range(random.randint(3, 7)):
            x, y = random.randint(0, width), random.randint(0, height)
            await self.page.mouse.move(x, y)
            await asyncio.sleep(random.uniform(0.1, 0.3))
    
    async def solve_cloudflare_challenge(self, url: str, max_retries: int = 5) -> bool:
        """Visit URL and attempt to solve Cloudflare challenges"""
        
        if not self.is_initialized:
            if not await self.initialize():
                return False
        
        logger.info(f"Attempting to solve Cloudflare challenge for: {url}")
        
        for attempt in range(1, max_retries + 1):
            try:
                # First visit home page to establish cookies
                logger.info(f"Visiting home page first to establish cookies")
                site_base = url.split('/')[0] + '//' + url.split('/')[2]
                
                # Navigate to the home page
                response = await self.page.goto(site_base, timeout=60000)
                
                # Wait longer for initial cloudflare challenge
                await asyncio.sleep(10)  # Wait for Cloudflare challenge to appear
                
                # Check for challenge text
                content = await self.page.content()
                if "Checking your browser" in content or "Verifying you are human" in content:
                    logger.info("Cloudflare challenge detected, waiting for it to be solved...")
                    
                    # Wait long enough for challenge to complete (adjust as needed)
                    try:
                        # Wait for the challenge to disappear and page to load
                        await self.page.wait_for_function(
                            """
                            !document.body.innerText.includes('Checking your browser') && 
                            !document.body.innerText.includes('Verifying you are human')
                            """,
                            timeout=30000
                        )
                        logger.info("Challenge appears to be solved")
                    except TimeoutError:
                        logger.warning("Timed out waiting for challenge to be solved")
                
                # Now navigate to the actual URL if different from home
                if url != site_base:
                    await asyncio.sleep(random.uniform(2, 4))  # Human-like delay
                    await self.random_mouse_movements()  # More human-like behavior
                    logger.info(f"Navigating to target URL: {url}")
                    response = await self.page.goto(url, timeout=60000)
                
                # Wait for network to be idle
                await self.page.wait_for_load_state("networkidle", timeout=30000)
                
                # Check if we're still facing a challenge
                content = await self.page.content()
                self.last_page_content = content
                
                if "Checking your browser" in content or "Verifying you are human" in content:
                    if attempt < max_retries:
                        wait_time = 5 * attempt  # Exponential wait
                        logger.warning(f"Still facing Cloudflare challenge. Retrying in {wait_time} seconds...")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        logger.error("Failed to bypass Cloudflare after maximum retries")
                        return False
                
                # If we get here, we've successfully bypassed Cloudflare
                logger.info("Successfully bypassed Cloudflare protection")
                return True
                
            except Exception as e:
                logger.error(f"Error during Cloudflare bypass (attempt {attempt}): {e}")
                if attempt < max_retries:
                    wait_time = 5 * attempt  # Exponential wait
                    logger.warning(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.error("Failed to bypass Cloudflare after maximum retries")
                    return False
        
        return False
    
    async def get_page_content(self) -> str:
        """Get the current page content"""
        if not self.is_initialized or not self.page:
            logger.error("Browser not initialized")
            return ""
        
        return self.last_page_content or await self.page.content()
    
    async def cleanup(self):
        """Clean up resources"""
        try:
            if self.page:
                await self.page.close()
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            if hasattr(self, 'playwright'):
                await self.playwright.stop()
            
            self.browser = None
            self.context = None
            self.page = None
            self.is_initialized = False
            logger.info("Browser resources cleaned up")
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")