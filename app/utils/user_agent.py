import random
from typing import List, Optional, Union

def generate_user_agent(
  browser: Optional[Union[str, List[str]]] = None,
  os: Optional[Union[str, List[str]]] = None,
  device_type: Optional[Union[str, List[str]]] = None,
) -> str:
  """
  Generate a random User-Agent string.
  
  Args:
    browser: Specific browser(s) to use. If None, a random one will be chosen.
    os: Specific operating system(s) to use. If None, a random one will be chosen.
    device_type: Specific device type(s) to use. If None, a random one will be chosen.
    
  Returns:
    A randomly generated User-Agent string.
  """
  # Define browser options
  browsers = {
    "chrome": {
      "name": "Chrome",
      "versions": [f"{i}" for i in range(70, 110)],
      "engine": "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} Safari/537.36",
    },
    "firefox": {
      "name": "Firefox",
      "versions": [f"{i}.0" for i in range(60, 100)],
      "engine": "Gecko/20100101 Firefox/{version}",
    },
    "safari": {
      "name": "Safari",
      "versions": [f"{i}.{j}" for i in range(10, 16) for j in range(0, 7)],
      "engine": "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{version} Safari/605.1.15",
    },
    "edge": {
      "name": "Edge",
      "versions": [f"{i}" for i in range(80, 110)],
      "engine": "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} Safari/537.36 Edg/{version}",
    },
    "opera": {
      "name": "Opera",
      "versions": [f"{i}" for i in range(60, 90)],
      "engine": "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Safari/537.36 OPR/{version}",
      "chrome_versions": [f"{i}" for i in range(70, 110)],
    },
  }
  
  # Define OS options
  operating_systems = {
    "windows": {
      "name": "Windows NT",
      "versions": ["10.0", "6.3", "6.2", "6.1"],
      "architectures": ["Win64; x64", "WOW64"],
    },
    "macos": {
      "name": "Macintosh",
      "versions": [f"10_{i}_{j}" for i in range(13, 16) for j in range(0, 7)],
      "architectures": ["Intel Mac OS X", "Mac OS X"],
    },
    "linux": {
      "name": "X11",
      "distributions": ["Linux x86_64", "Ubuntu; Linux x86_64", "Fedora; Linux x86_64"],
    },
    "android": {
      "name": "Android",
      "versions": [f"{i}.{j}.{k}" for i in range(8, 14) for j in range(0, 3) for k in range(0, 3)],
      "devices": ["SM-G960F", "SM-N975F", "Pixel 4", "Pixel 5", "Pixel 6"],
    },
    "ios": {
      "name": "iPhone",
      "versions": [f"{i}_{j}" for i in range(13, 17) for j in range(0, 7)],
      "devices": ["iPhone10,3", "iPhone11,8", "iPhone12,1", "iPhone13,2", "iPhone13,4"],
    },
  }
  
  # Define device types
  device_types = {
    "desktop": ["windows", "macos", "linux"],
    "mobile": ["android", "ios"],
    "tablet": ["android", "ios"],
  }
  
  # Select browser
  if browser:
    if isinstance(browser, list):
      selected_browser = random.choice(browser)
    else:
      selected_browser = browser
  else:
    selected_browser = random.choice(list(browsers.keys()))
  
  browser_info = browsers[selected_browser]
  browser_version = random.choice(browser_info["versions"])
  
  # Select OS
  if os:
    if isinstance(os, list):
      selected_os = random.choice(os)
    else:
      selected_os = os
  elif device_type:
    if isinstance(device_type, list):
      selected_device_type = random.choice(device_type)
    else:
      selected_device_type = device_type
    selected_os = random.choice(device_types[selected_device_type])
  else:
    selected_os = random.choice(list(operating_systems.keys()))
  
  os_info = operating_systems[selected_os]
  
  # Construct user agent based on OS
  ua_parts = []
  
  if selected_os == "windows":
    os_version = random.choice(os_info["versions"])
    architecture = random.choice(os_info["architectures"])
    ua_parts.append(f"Mozilla/5.0 (Windows NT {os_version}; {architecture})")
  
  elif selected_os == "macos":
    os_version = random.choice(os_info["versions"])
    architecture = random.choice(os_info["architectures"])
    ua_parts.append(f"Mozilla/5.0 ({os_info['name']}; {architecture} {os_version})")
  
  elif selected_os == "linux":
    distribution = random.choice(os_info["distributions"])
    ua_parts.append(f"Mozilla/5.0 ({os_info['name']}; {distribution})")
  
  elif selected_os == "android":
    os_version = random.choice(os_info["versions"])
    device = random.choice(os_info["devices"])
    ua_parts.append(f"Mozilla/5.0 (Linux; Android {os_version}; {device})")
  
  elif selected_os == "ios":
    os_version = random.choice(os_info["versions"])
    device = random.choice(os_info["devices"])
    ua_parts.append(f"Mozilla/5.0 (iPhone; CPU iPhone OS {os_version} like Mac OS X; {device})")
  
  # Add browser engine information
  if selected_browser == "opera":
    chrome_version = random.choice(browser_info["chrome_versions"])
    engine = browser_info["engine"].replace("{chrome_version}", chrome_version).replace("{version}", browser_version)
  else:
    engine = browser_info["engine"].replace("{version}", browser_version)
  
  ua_parts.append(engine)
  
  return " ".join(ua_parts)


def get_random_user_agent() -> str:
  """
  Shorthand function to get a completely random user agent.
  
  Returns:
    A randomly generated User-Agent string.
  """
  return generate_user_agent()


def get_desktop_user_agent() -> str:
  """
  Get a random desktop user agent.
  
  Returns:
    A randomly generated desktop User-Agent string.
  """
  return generate_user_agent(device_type="desktop")


def get_mobile_user_agent() -> str:
  """
  Get a random mobile user agent.
  
  Returns:
    A randomly generated mobile User-Agent string.
  """
  return generate_user_agent(device_type="mobile")


def get_chrome_user_agent() -> str:
  """
  Get a random Chrome user agent.
  
  Returns:
    A randomly generated Chrome User-Agent string.
  """
  return generate_user_agent(browser="chrome")


def get_firefox_user_agent() -> str:
  """
  Get a random Firefox user agent.
  
  Returns:
    A randomly generated Firefox User-Agent string.
  """
  return generate_user_agent(browser="firefox")