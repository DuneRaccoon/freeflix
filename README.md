### **Freeflix**

Freeflix is an open source streaming service, which can be used to automatically download torrents, autamtically stream torrents and schedule regular downloads.

* * *

### **Installation**

1.  Clone the repository:
    
    bash
    
    CopyEdit
    
    `git clone https://github.com/freeflix.git && cd freeflix`
    
2.  Run the installation script:
    
    bash
    
    CopyEdit
    
    `sudo bash install.sh`
    
3.  Check the service status:
    
    bash
    
    CopyEdit
    
    `sudo systemctl status freeflix`
    

* * *

### **Usage**

*   The service **automatically scrapes, fetches, and downloads torrents for the latest movies**.
*   Logs are stored in `logs/YYYY-MM-DD.log`.
*   To restart the service:
    
    bash
    
    CopyEdit
    
    `sudo systemctl restart freeflix`
    

* * *

### **Dependencies**

*   Python 3.10+
*   Poetry (for package management)
*   Libtorrent
*   BeautifulSoup, httpx, loguru