### **YIFY Downloader**

YIFY Downloader is an automated torrent management system that scrapes YTS for the latest movies, fetches available torrents, and downloads them efficiently using **libtorrent**.

* * *

### **Installation**

1.  Clone the repository:
    
    bash
    
    CopyEdit
    
    `git clone https://github.com/yify-scraper.git && cd yify_downloader`
    
2.  Run the installation script:
    
    bash
    
    CopyEdit
    
    `sudo bash install.sh`
    
3.  Check the service status:
    
    bash
    
    CopyEdit
    
    `sudo systemctl status yify_downloader`
    

* * *

### **Usage**

*   The service **automatically scrapes, fetches, and downloads torrents for the latest movies**.
*   Logs are stored in `logs/YYYY-MM-DD.log`.
*   To restart the service:
    
    bash
    
    CopyEdit
    
    `sudo systemctl restart yify_downloader`
    

* * *

### **Dependencies**

*   Python 3.10+
*   Poetry (for package management)
*   Libtorrent
*   BeautifulSoup, httpx, loguru