/**
 * ==============================================================================
 * VisionCraft Studio - AR Catalog Module (كتالوج الأصول والملابس الافتراضية)
 * ==============================================================================
 * Responsibilities:
 * 1. Default embedded assets catalog with precise landmark keypoints
 * 2. Asynchronous server catalog synchronization (/api/catalog)
 * 3. Asset preloading and caching in memory for 60 FPS rendering
 * ==============================================================================
 */

const DEFAULT_CATALOG = {
  "cap": {
    "id": "cap",
    "title": "الكوافي والقبعات",
    "icon": "🧢",
    "type": "cap",
    "shelf": "left",
    "items": [
      {
        "id": "cap_1",
        "category": "cap",
        "type": "cap",
        "title": "كوفية / قبعة راقية #1",
        "url": "things_assets/cap/cap_1.png",
        "width": 736,
        "height": 736,
        "keypoints": {
          "5": [
            0.2269,
            0.4144
          ],
          "2": [
            0.4049,
            0.411
          ]
        }
      },
      {
        "id": "cap_2",
        "category": "cap",
        "type": "cap",
        "title": "كوفية / قبعة راقية #2",
        "url": "things_assets/cap/cap_2.png",
        "width": 720,
        "height": 1280,
        "keypoints": {
          "5": [
            0.2076,
            0.4969
          ],
          "2": [
            0.5014,
            0.4961
          ]
        }
      },
      {
        "id": "cap_3",
        "category": "cap",
        "type": "cap",
        "title": "bg removed png png",
        "url": "things_assets/cap/cap_3.png",
        "width": 736,
        "height": 1308,
        "keypoints": {
          "2": [
            0.4402,
            0.6193
          ],
          "5": [
            0.2405,
            0.6147
          ]
        }
      },
      {
        "id": "cap_4",
        "category": "cap",
        "type": "cap",
        "title": "كوفية / قبعة راقية #4",
        "url": "things_assets/cap/cap_4.png",
        "width": 736,
        "height": 1308,
        "keypoints": {
          "5": [
            0.4321,
            0.4897
          ],
          "2": [
            0.6583,
            0.4859
          ],
          "7": [
            0.7833,
            0.508
          ],
          "8": [
            0.3173,
            0.513
          ]
        }
      },
      {
        "id": "cap_5",
        "category": "cap",
        "type": "cap",
        "title": "Black Hat Png Free PNG Ima...",
        "url": "things_assets/cap/cap_5.png",
        "width": 735,
        "height": 752,
        "keypoints": {
          "2": [
            0.7034,
            0.8976
          ],
          "5": [
            0.3986,
            0.8983
          ]
        }
      }
    ]
  },
  "glasses": {
    "id": "glasses",
    "title": "النظارات الشمسية والطبية",
    "icon": "👓",
    "type": "glasses",
    "shelf": "left",
    "items": [
      {
        "id": "glasses_1",
        "category": "glasses",
        "type": "glasses",
        "title": "نظارة أنيقة #1",
        "url": "things_assets/glasses/glasses_1.png",
        "width": 736,
        "height": 980,
        "keypoints": {
          "5": [
            0.25,
            0.548
          ],
          "2": [
            0.6963,
            0.552
          ]
        }
      },
      {
        "id": "glasses_2",
        "category": "glasses",
        "type": "glasses",
        "title": "نظارة أنيقة #2",
        "url": "things_assets/glasses/glasses_2.png",
        "width": 570,
        "height": 760,
        "keypoints": {
          "2": [
            0.6816,
            0.5039
          ],
          "5": [
            0.3465,
            0.5039
          ]
        }
      },
      {
        "id": "glasses_3",
        "category": "glasses",
        "type": "glasses",
        "title": "نظارة أنيقة #3",
        "url": "things_assets/glasses/glasses_3.png",
        "width": 600,
        "height": 548,
        "keypoints": {
          "5": [
            0.3258,
            0.5082
          ],
          "2": [
            0.6725,
            0.5073
          ]
        }
      },
      {
        "id": "glasses_4",
        "category": "glasses",
        "type": "glasses",
        "title": "Black sunglasses with dark...",
        "url": "things_assets/glasses/glasses_4.png",
        "width": 626,
        "height": 626,
        "keypoints": {
          "2": [
            0.7061,
            0.4073
          ],
          "5": [
            0.2764,
            0.4137
          ]
        }
      },
      {
        "id": "glasses_5",
        "category": "glasses",
        "type": "glasses",
        "title": "Gafas De Sol Complementos ...",
        "url": "things_assets/glasses/glasses_5.png",
        "width": 360,
        "height": 360,
        "keypoints": {
          "5": [
            0.2861,
            0.4972
          ],
          "2": [
            0.7278,
            0.4958
          ]
        }
      },
      {
        "id": "glasses_6",
        "category": "glasses",
        "type": "glasses",
        "title": "Goggles Aviator Sunglasses...",
        "url": "things_assets/glasses/glasses_6.png",
        "width": 728,
        "height": 724,
        "keypoints": {
          "2": [
            0.7266,
            0.4296
          ],
          "5": [
            0.2761,
            0.4323
          ]
        }
      },
      {
        "id": "glasses_7",
        "category": "glasses",
        "type": "glasses",
        "title": "Grandpa Glasses Transparen...",
        "url": "things_assets/glasses/glasses_7.png",
        "width": 735,
        "height": 752,
        "keypoints": {
          "5": [
            0.2776,
            0.494
          ],
          "2": [
            0.7116,
            0.4947
          ]
        }
      }
    ]
  },
  "graduition": {
    "id": "graduition",
    "title": "أزياء وقبعات التخرج",
    "icon": "🎓",
    "type": "graduition",
    "shelf": "left",
    "items": [
      {
        "id": "graduition_1",
        "category": "graduition",
        "type": "graduition",
        "title": "graduation   by @ecletc pn...",
        "url": "things_assets/graduition/graduition_1.png",
        "width": 344,
        "height": 390,
        "keypoints": {
          "2": [
            0.5669,
            0.3923
          ],
          "5": [
            0.3939,
            0.391
          ]
        }
      }
    ]
  },
  "hair": {
    "id": "hair",
    "title": "قصات الشعر والباروكات",
    "icon": "💇",
    "type": "hair",
    "shelf": "left",
    "items": [
      {
        "id": "hair_1",
        "category": "hair",
        "type": "hair",
        "title": "قصة شعر عصرية #1",
        "url": "things_assets/hair/hair_1.png",
        "width": 300,
        "height": 233,
        "keypoints": {
          "9": [
            0.8117,
            0.8584
          ],
          "10": [
            0.2867,
            0.9077
          ]
        }
      },
      {
        "id": "hair_2",
        "category": "hair",
        "type": "hair",
        "title": "قصة شعر عصرية #2",
        "url": "things_assets/hair/hair_2.png",
        "width": 650,
        "height": 472,
        "keypoints": {
          "10": [
            0.2023,
            0.9078
          ],
          "9": [
            0.8238,
            0.8877
          ]
        }
      },
      {
        "id": "hair_3",
        "category": "hair",
        "type": "hair",
        "title": "Download free png of PNG U...",
        "url": "things_assets/hair/hair_3.png",
        "width": 735,
        "height": 681,
        "keypoints": {
          "9": [
            0.8272,
            0.9163
          ],
          "10": [
            0.1796,
            0.9559
          ]
        }
      },
      {
        "id": "hair_4",
        "category": "hair",
        "type": "hair",
        "title": "Piv   Google Drive jpg",
        "url": "things_assets/hair/hair_4.png",
        "width": 350,
        "height": 263,
        "keypoints": {
          "10": [
            0.3043,
            0.9411
          ],
          "9": [
            0.8357,
            0.8973
          ]
        }
      }
    ]
  },
  "maried": {
    "id": "maried",
    "title": "أزياء وبدلات الأعراس (تركيب الوجه)",
    "icon": "👰",
    "type": "maried",
    "shelf": "right",
    "items": [
      {
        "id": "maried_1",
        "category": "maried",
        "type": "maried",
        "title": "زي عريس ومناسبات #1",
        "url": "things_assets/maried/maried_1.png",
        "width": 736,
        "height": 1389,
        "keypoints": {
          "12": [
            0.2289,
            0.3175
          ],
          "11": [
            0.7663,
            0.3153
          ]
        }
      },
      {
        "id": "maried_2",
        "category": "maried",
        "type": "maried",
        "title": "bg removed png png",
        "url": "things_assets/maried/maried_2.png",
        "width": 564,
        "height": 924,
        "keypoints": {
          "11": [
            0.7615,
            0.3772
          ],
          "12": [
            0.2589,
            0.3874
          ]
        }
      },
      {
        "id": "maried_3",
        "category": "maried",
        "type": "maried",
        "title": "( ) png",
        "url": "things_assets/maried/maried_3.png",
        "width": 736,
        "height": 1263,
        "keypoints": {
          "11": [
            0.897,
            0.1555
          ],
          "12": [
            0.004,
            0.1645
          ]
        }
      },
      {
        "id": "maried_4",
        "category": "maried",
        "type": "maried",
        "title": "bg removed png png",
        "url": "things_assets/maried/maried_4.png",
        "width": 736,
        "height": 1308,
        "keypoints": {
          "11": [
            0.7724,
            0.3712
          ],
          "12": [
            0.2174,
            0.3735
          ]
        }
      },
      {
        "id": "maried_5",
        "category": "maried",
        "type": "maried",
        "title": "Download لبس تهامي png bg ...",
        "url": "things_assets/maried/maried_5.png",
        "width": 564,
        "height": 689,
        "keypoints": {
          "12": [
            0.3626,
            0.4819
          ],
          "11": [
            0.641,
            0.4347
          ]
        }
      },
      {
        "id": "maried_6",
        "category": "maried",
        "type": "maried",
        "title": "زي رقم لبس عريس يمني تقليد...",
        "url": "things_assets/maried/maried_6.png",
        "width": 736,
        "height": 1105,
        "keypoints": {
          "12": [
            0.6189,
            0.3371
          ],
          "11": [
            0.2656,
            0.3167
          ]
        }
      },
      {
        "id": "maried_7",
        "category": "maried",
        "type": "maried",
        "title": "لبس عرسان اليمن bg removed...",
        "url": "things_assets/maried/maried_7.png",
        "width": 736,
        "height": 981,
        "keypoints": {
          "11": [
            0.7344,
            0.2421
          ],
          "12": [
            0.4341,
            0.2599
          ]
        }
      },
      {
        "id": "maried_8",
        "category": "maried",
        "type": "maried",
        "title": "لبس عريس يمني بالشال الازر...",
        "url": "things_assets/maried/maried_8.png",
        "width": 736,
        "height": 1104,
        "keypoints": {
          "12": [
            0.2887,
            0.3986
          ],
          "11": [
            0.7466,
            0.3732
          ]
        }
      }
    ]
  },
  "mask": {
    "id": "mask",
    "title": "اللثام والكمامات والشماغ",
    "icon": "😷",
    "type": "mask",
    "shelf": "left",
    "items": [
      {
        "id": "mask_1",
        "category": "mask",
        "type": "mask",
        "title": "Houndstooth Keffiyeh Shema...",
        "url": "things_assets/mask/mask_1.png",
        "width": 281,
        "height": 500,
        "keypoints": {
          "9": [
            0.6281,
            0.202
          ],
          "10": [
            0.3826,
            0.215
          ]
        }
      }
    ]
  },
  "suite": {
    "id": "suite",
    "title": "البدلات والملابس الرسمية",
    "icon": "👔",
    "type": "suit",
    "shelf": "right",
    "items": [
      {
        "id": "suite_1",
        "category": "suite",
        "type": "suit",
        "title": "bg removed png png",
        "url": "things_assets/suite/suite_1.png",
        "width": 736,
        "height": 1083,
        "keypoints": {
          "12": [
            0.2486,
            0.157
          ],
          "11": [
            0.7351,
            0.1528
          ]
        }
      },
      {
        "id": "suite_2",
        "category": "suite",
        "type": "suit",
        "title": "Mens Wearing Suit Passport...",
        "url": "things_assets/suite/suite_2.png",
        "width": 360,
        "height": 360,
        "keypoints": {
          "11": [
            0.7097,
            0.1847
          ],
          "12": [
            0.2903,
            0.2139
          ]
        }
      },
      {
        "id": "suite_3",
        "category": "suite",
        "type": "suit",
        "title": "@sunvsstars bg removed png...",
        "url": "things_assets/suite/suite_3.png",
        "width": 736,
        "height": 736,
        "keypoints": {
          "11": [
            0.5523,
            0.091
          ],
          "12": [
            0.4185,
            0.1067
          ]
        }
      },
      {
        "id": "suite_4",
        "category": "suite",
        "type": "suit",
        "title": "Download free png of Men's...",
        "url": "things_assets/suite/suite_4.png",
        "width": 714,
        "height": 1000,
        "keypoints": {
          "11": [
            0.7724,
            0.1805
          ],
          "12": [
            0.2465,
            0.175
          ]
        }
      },
      {
        "id": "suite_5",
        "category": "suite",
        "type": "suit",
        "title": "Professional Black Suit Pa...",
        "url": "things_assets/suite/suite_5.png",
        "width": 640,
        "height": 640,
        "keypoints": {
          "12": [
            0.257,
            0.3445
          ],
          "11": [
            0.7336,
            0.343
          ]
        }
      },
      {
        "id": "suite_6",
        "category": "suite",
        "type": "suit",
        "title": "Suit Clothing Coat PNG bg ...",
        "url": "things_assets/suite/suite_6.png",
        "width": 728,
        "height": 636,
        "keypoints": {
          "11": [
            0.7253,
            0.5542
          ],
          "12": [
            0.2163,
            0.5857
          ]
        }
      },
      {
        "id": "suite_7",
        "category": "suite",
        "type": "suit",
        "title": "Suit Clothing PNG bg remov...",
        "url": "things_assets/suite/suite_7.png",
        "width": 310,
        "height": 412,
        "keypoints": {
          "12": [
            0.079,
            0.6845
          ],
          "11": [
            0.8952,
            0.699
          ]
        }
      },
      {
        "id": "suite_8",
        "category": "suite",
        "type": "suit",
        "title": "T shirt Suit Waistcoat Pan...",
        "url": "things_assets/suite/suite_8.png",
        "width": 728,
        "height": 680,
        "keypoints": {
          "11": [
            0.6422,
            0.1493
          ],
          "12": [
            0.3365,
            0.1721
          ]
        }
      },
      {
        "id": "suite_9",
        "category": "suite",
        "type": "suit",
        "title": "Tuxedo bg removed png png",
        "url": "things_assets/suite/suite_9.png",
        "width": 640,
        "height": 1064,
        "keypoints": {
          "12": [
            0.3953,
            0.0573
          ],
          "11": [
            0.6945,
            0.0766
          ]
        }
      },
      {
        "id": "suite_10",
        "category": "suite",
        "type": "suit",
        "title": "finishing suit men bg remo...",
        "url": "things_assets/suite/suite_10.png",
        "width": 736,
        "height": 736,
        "keypoints": {
          "11": [
            0.6692,
            0.3852
          ],
          "12": [
            0.2561,
            0.4171
          ]
        }
      },
      {
        "id": "suite_11",
        "category": "suite",
        "type": "suit",
        "title": "제품 실물, 남성복, 양복 일러스트 PNG, 회...",
        "url": "things_assets/suite/suite_11.png",
        "width": 600,
        "height": 800,
        "keypoints": {
          "12": [
            0.1133,
            0.6256
          ],
          "11": [
            0.8983,
            0.62
          ]
        }
      }
    ]
  },
  "wishah": {
    "id": "wishah",
    "title": "الأوشحة والسكارفات",
    "icon": "🧣",
    "type": "wishah",
    "shelf": "left",
    "items": [
      {
        "id": "wishah_1",
        "category": "wishah",
        "type": "wishah",
        "title": "bg removed png png",
        "url": "things_assets/wishah/wishah_1.png",
        "width": 626,
        "height": 1000,
        "keypoints": {
          "11": [
            0.9768,
            0.177
          ],
          "12": [
            0.0,
            0.1775
          ]
        }
      },
      {
        "id": "wishah_2",
        "category": "wishah",
        "type": "wishah",
        "title": "IronSeals Cotton Desert Ar...",
        "url": "things_assets/wishah/wishah_2.png",
        "width": 736,
        "height": 705,
        "keypoints": {
          "12": [
            0.089,
            0.3
          ],
          "11": [
            0.8274,
            0.2333
          ]
        }
      }
    ]
  }
};

class ARCatalogManager {
    constructor(catalogData = (typeof DEFAULT_CATALOG !== 'undefined' ? DEFAULT_CATALOG : null)) {
        this.catalog = catalogData;
        this.assets = {};
    }

    async fetchServerCatalog() {
        try {
            const resp = await fetch('/api/catalog');
            if (resp.ok) {
                const data = await resp.json();
                if (data && Object.keys(data).length > 0) {
                    this.catalog = data;
                    this.preloadAssets();
                }
            }
        } catch (e) {
            console.warn('[ARCatalogManager] Could not fetch /api/catalog:', e);
        }
    }

    preloadAssets() {
        if (!this.catalog) return;
        Object.keys(this.catalog).forEach(catKey => {
            const cat = this.catalog[catKey];
            if (cat && cat.items) {
                cat.items.forEach(item => {
                    if (!this.assets[item.id]) {
                        const img = new Image();
                        img.src = item.url;
                        this.assets[item.id] = img;
                    }
                });
            }
        });
    }

    getAsset(itemId) {
        return this.assets[itemId] || null;
    }

    getCategory(catId) {
        return (this.catalog && this.catalog[catId]) || null;
    }

    getItem(catId, itemId) {
        const cat = this.getCategory(catId);
        if (!cat || !cat.items) return null;
        return cat.items.find(it => it.id === itemId) || null;
    }
}

// Global exposure for modular scripts and backwards-compatibility
window.DEFAULT_CATALOG = DEFAULT_CATALOG;
window.ARCatalogManager = ARCatalogManager;
