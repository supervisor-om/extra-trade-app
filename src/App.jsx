import React, { useState, useEffect, useMemo, useCallback } from 'react';
// تمت إزالة جميع استدعاءات Firebase

// --- الثوابت الرئيسية ---
const POINTS_FACTOR = 1; 
const DOLLAR_PER_POINT = 0.1;

// --- بيانات اللوجو (تم تشفيرها إلى Base64) ---
const LOGO_BASE64_FOR_HEADER = "/9j/4AAQSkZJRgABAQEAYABgAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAEAAAAAAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAEAAQEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBgcIEyExURQiQhYjVHGQCcHRM,s/4y/9K/8AwA//9k="; 

const HEADER_LOGO_BASE64 = LOGO_BASE64_FOR_HEADER;
const WATERMARK_TEXT = "EXTRA TRADE"; 

// --- دوال مساعدة لحساب الوقت والأسبوع ---
const getWeekId = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
};

const parsePrice = (priceString) => {
    const cleanedString = priceString.replace(/,/g, '.');
    return parseFloat(cleanedString);
};

const parseTradeText = (text) => {
    try {
        const lines = text.split('\n')
                           .map(line => line.trim())
                           .filter(line => line.length > 0);
        
        if (lines.length < 3) {
            return { error: 'النص المدخل غير كافٍ. يجب أن يحتوي على النوع، الدخول، والوقف على الأقل.' };
        }

        const trade = {};
        const tps = [];

        const firstLine = lines[0].trim();
        const typeMatch = firstLine.match(/^(Sell|Buy)\s+(.*)/i);
        if (!typeMatch || typeMatch.length < 3) {
            return { error: 'لم يتم العثور على نوع الصفقة (Buy/Sell) واسم الأداة في السطر الأول. (مثال: Sell US30)' };
        }
        trade.type = typeMatch[1].toUpperCase();
        trade.symbol = typeMatch[2].trim().toUpperCase(); 

        for (const line of lines.slice(1)) {
            const parts = line.split(':');
            if (parts.length < 2) continue; 

            const key = parts[0].trim().toUpperCase();
            const value = parts.slice(1).join(':').trim();

            if (key === 'ENTRY') {
                trade.entry = parsePrice(value);
                
            } else if (key === 'SL' || key.startsWith('TP')) {
                const pointsRegex = /\(\s*([\+\-−]?\s*\d+)\s*\)/;
                const pointsMatch = value.match(pointsRegex);
                
                if (!pointsMatch) {
                    return { error: `خطأ في تحليل النقاط لـ ${key}: يجب أن تكون محاطة بأقواس (مثال: (+50) أو (-100)).` };
                }
                
                const pointsString = pointsMatch[1].replace(/\s/g, '').replace(/−/g, '-');
                const points = parseInt(pointsString);
                
                const priceString = value.replace(pointsMatch[0], '').trim();
                const price = parsePrice(priceString);
                
                if (isNaN(price)) {
                     return { error: `خطأ في تحليل سعر ${key}: "${priceString}" ليس رقماً صحيحاً.` };
                }

                if (key === 'SL') {
                    trade.sl = price;
                    trade.slPoints = points; 
                } else {
                    tps.push({
                        name: key,
                        price: price,
                        points: points, 
                    });
                }
            }
        }

        trade.tps = tps.sort((a, b) => a.name.localeCompare(b.name));

        if (!trade.entry || isNaN(trade.entry)) return { error: 'لم يتم العثور على سعر الدخول (Entry) أو أنه غير صحيح.' };
        if (!trade.sl || isNaN(trade.sl) || trade.slPoints === undefined || isNaN(trade.slPoints)) return { error: 'لم يتم العثور على سعر الوقف (SL) أو نقاطه أو أنها غير صحيحة.' };
        if (tps.length === 0) return { error: 'الرجاء تحديد هدف واحد على الأقل (TP1).' };

        return { trade };
    } catch (e) {
        console.error("Critical parsing error:", e);
        return { error: `خطأ فادح غير متوقع أثناء تحليل النص: ${e.message}` };
    }
};

// --- المكونات الفرعية ---

const StatCard = ({ title, value, colorClass }) => (
    <div className={`p-4 rounded-xl shadow-lg transition duration-300 transform hover:scale-[1.02] ${colorClass}`}>
        <p className="text-sm font-medium opacity-80 mb-1">{title}</p>
        <p className="text-2xl font-extrabold text-right">{value}</p>
    </div>
);

const LoadingMessage = ({ message, isError = false }) => (
    <div className={`text-center p-6 rounded-xl font-medium ${isError ? 'bg-red-100 text-red-700' : 'bg-indigo-50 text-indigo-700'}`}>
        {message}
    </div>
);

/**
 * نافذة تأكيد الحذف المخصصة
 */
const ConfirmModal = ({ isOpen, message, onConfirm, onCancel }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 transition-opacity duration-300">
            <div className="bg-white rounded-lg shadow-2xl p-6 w-96 transform transition-all duration-300 scale-100" style={{ direction: 'rtl' }}>
                <h3 className="text-xl font-bold text-red-600 mb-4">تأكيد الحذف</h3>
                <p className="text-gray-700 mb-6">{message}</p>
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
                    >
                        إلغاء
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
                    >
                        حذف نهائي
                    </button>
                </div>
            </div>
        </div>
    );
};


const NewTradeForm = ({ onAddTrade }) => {
    const exampleText = `Sell US30\nEntry: 46350\nSL: 46425 (-75)\nTP1: 46300 (+50)\nTP2: 46250 (+100)\nTP3: 46200 (+150)`;
    const [tradeText, setTradeText] = useState(exampleText); 
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    
    const textAreaRef = React.useRef(null);
    
    const handlePaste = () => {
        if (textAreaRef.current) {
            textAreaRef.current.focus();
            setMessage('⚠️ يرجى اللصق يدوياً (Ctrl+V أو الضغط المطول ثم لصق).');
            setTimeout(() => setMessage(''), 5000);
        }
    };

    const handleClear = () => {
        setTradeText('');
        setMessage('تم مسح مربع النص.');
        setTimeout(() => setMessage(''), 3000);
    };


    const handleSubmit = useCallback((e) => {
        e.preventDefault();
        if (!tradeText.trim()) return setMessage('الرجاء لصق تفاصيل الصفقة أولاً.');

        setMessage('');
        setIsLoading(true);

        const { trade, error } = parseTradeText(tradeText);

        if (error) {
            setIsLoading(false);
            return setMessage(`❌ خطأ في التحليل: ${error}`);
        }

        // إنشاء صفقة جديدة بدون Firebase
        const newTrade = {
            id: Math.random().toString(36).substring(2, 9), // معرف مؤقت
            type: trade.type,
            symbol: trade.symbol,
            entry: trade.entry,
            sl: trade.sl,
            slPoints: trade.slPoints, 
            tps: trade.tps, 
            status: 'OPEN',
            outcome: null,
            points: 0,
            dollarProfit: 0,
            date: new Date().getTime(),
            weekId: getWeekId(new Date()),
        };

        onAddTrade(newTrade); // إرسال الصفقة إلى المكون الأب
        
        setMessage('✅ تم تسجيل الصفقة بنجاح وهي الآن مفتوحة.');
        setTradeText(''); 

        setTimeout(() => setIsLoading(false), 500);
        setTimeout(() => setMessage(''), 5000);
        
    }, [tradeText, onAddTrade]);

    return (
        <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-lg">
            <h3 className="text-xl font-bold mb-4 text-indigo-700">إضافة صفقة جديدة (لصق النص)</h3>
            
            <p className="text-sm text-gray-600 mb-4">
                الصق تفاصيل الصفقة هنا. (كل 10 نقاط = 1$).
                <span className="font-bold text-red-500 block mt-1">ملاحظة: البيانات لن تحفظ عند تحديث الصفحة!</span>
            </p>
            
            <div className="mb-4">
                <textarea
                    id="tradeText"
                    rows="8"
                    value={tradeText}
                    onChange={(e) => setTradeText(e.target.value)}
                    placeholder={exampleText} 
                    className="w-full p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-left font-mono text-sm"
                    required
                    style={{ direction: 'ltr', textAlign: 'left' }}
                    ref={textAreaRef} // ربط ref بمربع النص
                />
            </div>

            <div className="flex gap-2 justify-end mb-4">
                <button
                    type="button"
                    onClick={handlePaste}
                    className="flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 transition"
                    title="الصق النص من ذاكرة التخزين المؤقت (Clipboard)"
                >
                    <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                    لصق من الحافظة
                </button>
                <button
                    type="button"
                    onClick={handleClear}
                    className="flex items-center justify-center px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
                    title="مسح محتوى مربع النص"
                >
                    <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    مسح
                </button>
            </div>


            {message && (
                <div className={`p-3 mb-4 rounded-lg text-center font-semibold ${message.includes('نجاح') ? 'bg-green-100 text-green-700' : message.includes('خطأ') ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {message}
                </div>
            )}
            

            <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 py-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition duration-300 disabled:opacity-50 shadow-md"
            >
                {isLoading ? 'جاري تحليل وتسجيل الصفقة...' : 'تحليل وتسجيل الصفقة (Enter)'}
            </button>
        </form>
    );
};


/**
 * قائمة الصفقات المفتوحة لإغلاقها
 */
const OpenTradesList = ({ openTrades, onUpdateTrade, onDeleteTrade }) => {
    const [message, setMessage] = useState('');
    const [tradeToDelete, setTradeToDelete] = useState(null);

    const handleConfirmDelete = (trade) => {
        setTradeToDelete(trade);
    };

    const handleDeleteTrade = () => {
        if (!tradeToDelete) return;
        
        onDeleteTrade(tradeToDelete.id);
        setMessage(`✅ تم حذف الصفقة #${tradeToDelete.id.substring(0, 4)} لـ ${tradeToDelete.symbol} بنجاح.`);
        setTradeToDelete(null);
        setTimeout(() => setMessage(''), 5000);
    };


    const handleCloseTrade = (trade, outcome) => {
        setMessage('');

        const isSL = outcome === 'SL';
        let exitPrice;
        let calculatedPoints; 

        if (isSL) {
            exitPrice = trade.sl;
            calculatedPoints = trade.slPoints; 
        } else {
            const tpData = trade.tps.find(t => t.name === outcome);
            if (!tpData) {
                return setMessage('خطأ: لم يتم العثور على بيانات الهدف.');
            }
            exitPrice = tpData.price;
            calculatedPoints = tpData.points; 
        }

        const dollarProfit = calculatedPoints * DOLLAR_PER_POINT;
        
        const updatedTrade = {
            ...trade,
            status: 'CLOSED',
            outcome: outcome,
            points: calculatedPoints, 
            dollarProfit: dollarProfit,
            closeDate: new Date().getTime(),
        };

        onUpdateTrade(updatedTrade);

        setMessage(`✅ تم إغلاق ${trade.symbol} (${trade.type}) على ${outcome}. النقاط: ${calculatedPoints > 0 ? '+' : ''}${calculatedPoints.toFixed(2)}.`);
        setTimeout(() => setMessage(''), 5000);
    };

    if (openTrades.length === 0) {
        return (
            <div className="p-6 bg-white rounded-xl shadow-lg text-center text-gray-500">
                لا توجد صفقات مفتوحة حالياً.
            </div>
        );
    }

    // حساب متغير الرسالة بشكل آمن قبل JSX باستخدام && بدلاً من ?.
    const deleteTradeId = (tradeToDelete && tradeToDelete.id) ? tradeToDelete.id.substring(0, 4) : '';
    const deleteTradeSymbol = (tradeToDelete && tradeToDelete.symbol) || '';
    const confirmMessage = 'هل أنت متأكد من حذف الصفقة #' + deleteTradeId + ' لـ ' + deleteTradeSymbol + '؟ لا يمكن التراجع عن هذا الإجراء.';

    return (
        <div className="p-6 bg-white rounded-xl shadow-lg">
            <h3 className="text-xl font-bold mb-4 text-indigo-700">الصفقات المفتوحة ({openTrades.length})</h3>
            {message && (
                <div className={`p-3 mb-4 rounded-lg text-center font-semibold ${message.includes('نجاح') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {message}
                </div>
            )}
            <div className="space-y-4 max-h-96 overflow-y-auto">
                {openTrades.map((trade) => (
                    <div key={trade.id} className="p-4 border border-gray-200 rounded-lg shadow-sm bg-gray-50">
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center space-x-2 space-x-reverse">
                                <span className={`text-sm font-bold px-3 py-1 rounded-full text-white ${trade.type === 'BUY' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                    {trade.type === 'BUY' ? 'شراء' : 'بيع'}
                                
                                </span>
                                <span className="text-lg font-extrabold text-gray-800">{trade.symbol}</span>
                            </div>
                            <span className="text-gray-600 text-sm font-mono text-right">دخول: {trade.entry}</span>
                        </div>
                        <p className="text-sm text-gray-700 mb-3 text-right">
                            <span className="font-semibold">الوقف (SL): </span>{trade.sl} ({trade.slPoints} نقطة)
                        </p>
                        
                        <p className="text-sm font-semibold text-gray-800 mb-2 text-right">
                             الأهداف المتاحة:
                        </p>
                        
                        {/* Outcome Buttons and Delete Button */}
                        <div className="flex flex-wrap gap-2 justify-end items-center">
                            {trade.tps.map((tp) => (
                                <button
                                    key={tp.name}
                                    onClick={() => handleCloseTrade(trade, tp.name)}
                                    className="py-1 px-3 text-sm bg-indigo-500 text-white rounded-md hover:bg-indigo-600 transition flex items-center justify-center shadow-md"
                                >
                                    {tp.name} ({tp.points > 0 ? '+' : ''}{tp.points} نقطة)
                                </button>
                            ))}
                            <button
                                onClick={() => handleCloseTrade(trade, 'SL')}
                                className="py-1 px-3 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition flex items-center justify-center shadow-md"
                            >
                                وقف الخسارة (SL)
                            </button>

                            {/* زر الحذف */}
                            <button
                                onClick={() => handleConfirmDelete(trade)}
                                className="p-2 text-gray-400 hover:text-red-500 transition"
                                title="حذف الصفقة (مدخلة بالخطأ)"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
             
            /* نافذة تأكيد الحذف */
            <ConfirmModal 
                isOpen={!!tradeToDelete}
                message={confirmMessage}
                onConfirm={handleDeleteTrade}
                onCancel={() => setTradeToDelete(null)}
            />
        </div>
    );
};

// دالة مساعدة لتحميل سكربت خارجي بشكل ديناميكي (Promise based)
const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            // Script already exists, resolve immediately if libraries are loaded
            if (typeof window.html2canvas !== 'undefined' || typeof window.jspdf !== 'undefined') {
                resolve();
                return;
            }
        }

        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

/**
 * تقرير الأداء الأسبوعي
 */
const WeeklyReport = ({ trades, onDeleteTrade }) => {
    // حالة للتحكم في رسالة التصدير
    const [exportMessage, setExportMessage] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [tradeToDelete, setTradeToDelete] = useState(null); // لإدارة حذف الصفقات المغلقة
    
    // حساب الإجماليات الإضافية هنا مباشرة
    const { totalPoints, totalDollarProfit, closedTradesCount, totalWins, totalLosses, winRate } = useMemo(() => {
        const closed = trades.filter(t => t.status === 'CLOSED');
        const totalP = closed.reduce((sum, trade) => sum + (trade.points || 0), 0);
        const totalDP = closed.reduce((sum, trade) => sum + (trade.dollarProfit || 0), 0);
        const totalW = closed.filter(t => (t.points || 0) > 0).length;
        const totalL = closed.filter(t => (t.points || 0) < 0).length;
        const totalC = closed.length;
        const winR = totalC > 0 ? (totalW / totalC) * 100 : 0;
        
        return { totalPoints: totalP, totalDollarProfit: totalDP, closedTradesCount: totalC, totalWins: totalW, totalLosses: totalL, winRate: winR };
    }, [trades]);
    
    const closedTradesDetails = useMemo(() => {
        return trades.filter(t => t.status === 'CLOSED').map(t => ({
            id: t.id,
            symbol: t.symbol || 'N/A',
            type: t.type || 'N/A',
            outcome: t.outcome || 'N/A',
            points: t.points || 0,
            dollarProfit: t.dollarProfit || 0,
            closeDate: t.closeDate,
            weekId: t.weekId,
            exitPrice: t.outcome === 'SL' ? t.sl : t.tps?.find(tp => tp.name === t.outcome)?.price || 'N/A',
        })).sort((a, b) => b.closeDate - a.closeDate); // الأحدث أولاً
    }, [trades]);

    const formatDollar = (amount) => {
        const fixed = amount.toFixed(2);
        if (amount > 0) return `+$${fixed}`;
        if (amount < 0) return `-$${Math.abs(fixed).toFixed(2)}`;
        return '$0.00';
    };
    
    const formatPoints = (points) => {
        const fixed = points.toFixed(2);
        if (points > 0) return `+${fixed}`;
        if (points < 0) return fixed;
        return '0.00';
    };

    const handleConfirmDelete = (trade) => {
        setTradeToDelete(trade);
    };

    const handleDeleteTrade = () => {
        if (!tradeToDelete) return;
        
        onDeleteTrade(tradeToDelete.id);
        setExportMessage(`✅ تم حذف الصفقة #${tradeToDelete.id.substring(0, 4)} لـ ${tradeToDelete.symbol} بنجاح.`);
        setTradeToDelete(null);
        setTimeout(() => setExportMessage(''), 5000);
    };
    
    // ==========================================================
    // دالة تصدير التقرير كـ PDF
    // ==========================================================
    const generatePDF = async () => {
        setIsExporting(true);
        setExportMessage('جاري تحميل أدوات التصدير والتحضير للتقرير...');

        try {
            // 1. تحميل المكتبات بشكل متسلسل
            if (typeof window.html2canvas === 'undefined') {
                await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
            }
            if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
                await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
            }
            
            // 2. التحضير للتقرير
            setExportMessage('جاري إنشاء التقرير... قد يستغرق الأمر بضع ثوانٍ.');

            if (typeof window.html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
                throw new Error('فشل تحميل مكتبات التصدير.');
            }
            
            // 3. البدء في إنشاء PDF
            const dateStr = new Date().toISOString().slice(0, 10);
            
            const pdf = new window.jspdf.jsPDF({
                orientation: 'landscape', 
                unit: 'mm',
                format: 'a4' 
            });

            pdf.setFont('helvetica'); 
            
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            
            // --- دالة مساعدة لإضافة العلامة المائية ---
            const addWatermark = (pdf) => {
                // إعدادات النص المائل
                const wmText = WATERMARK_TEXT;
                
                // حفظ حالة الرسم الحالية
                pdf.saveGraphicsState(); 

                // تعيين شفافية 20% ولون رمادي باهت
                pdf.setGState(new window.jspdf.GState({ opacity: 0.20 })); 
                pdf.setTextColor(150, 150, 150); // رمادي فاتح
                
                // تعيين الخط وحجم كبير جداً
                pdf.setFontSize(80);
                
                // يتم الدوران حول النقطة المركزية
                const centerX = pdfWidth / 2;
                const centerY = pdfHeight / 2;

                pdf.text(wmText, centerX, centerY, {
                    angle: -45, // الدوران بزاوية 45-
                    align: 'center',
                    baseline: 'middle'
                });
                
                // استعادة حالة الرسم السابقة (مهم جداً!)
                pdf.restoreGraphicsState();
            };

            // --- 4. إضافة عناصر الرأس (Headings) ---
            
            const logoWidth = 25; // حجم الشعار بالملليمتر
            const logoHeight = 25; 
            const logoMargin = 10; 
            
            const logoX = logoMargin;
            const logoY = logoMargin;

            // 4.1 إضافة اللوجو في الزاوية (نستخدم الشعار الأوضح هنا)
            pdf.addImage(`data:image/jpeg;base64,${HEADER_LOGO_BASE64}`, 'JPEG', logoX, logoY, logoWidth, logoHeight);
            
            // 4.2 إضافة العلامة المائية للصفحة الأولى (في الخلفية)
            addWatermark(pdf);

            // 4.3 إضافة عنوان التقرير (إنجليزي لتجنب مشاكل الخطوط)
            pdf.setFontSize(18);
            
            const titleMarginRight = 10;
            const titleX = pdfWidth - titleMarginRight; 
            const titleY = logoY + logoHeight / 2 + 5; 
            
            pdf.text('Trading Performance Report', titleX, titleY, { align: 'right' }); 
            
            pdf.setFontSize(10);
            const dateText = `Date: ${dateStr}`;
            pdf.text(dateText, titleX, logoY + logoHeight + 10, { align: 'right' });
            
            
            // 6. استخدام html2canvas لأخذ لقطة للجداول
            const summaryElement = document.getElementById('summary-table-container');
            const tableElement = document.getElementById('detailed-table-container');

            if (!summaryElement || !tableElement) {
                 throw new Error('لم يتم العثور على عنصر التقرير.');
            }

            // إخفاء العناصر غير المطلوبة
            const button = document.getElementById('export-button');
            const messageDiv = document.getElementById('export-message-div');
            const deleteHeaders = document.querySelectorAll('.delete-header, .delete-cell');
            deleteHeaders.forEach(el => el.style.display = 'none');


            if (button) button.style.display = 'none';
            if (messageDiv) messageDiv.style.display = 'none';

            let yPosition = logoY + logoHeight + 20;

            // --- 6.1 التقاط صورة الملخص ---
            const summaryCanvas = await window.html2canvas(summaryElement, {
                scale: 2, 
                logging: false,
                useCORS: true, 
                backgroundColor: '#ffffff' 
            });
            const summaryImgData = summaryCanvas.toDataURL('image/png');
            const summaryProps = pdf.getImageProperties(summaryImgData);
            
            const summaryWidth = pdfWidth - 10;
            const summaryHeight = summaryWidth / (summaryProps.width / summaryProps.height);
            
            // إضافة الملخص في الصفحة الأولى
            pdf.addImage(summaryImgData, 'PNG', 5, yPosition, summaryWidth, summaryHeight);
            yPosition += summaryHeight + 10; 
            
            // --- 6.2 التقاط صورة الجدول التفصيلي ---
            const detailedCanvas = await window.html2canvas(tableElement, {
                scale: 2, 
                logging: false,
                useCORS: true, 
                backgroundColor: '#ffffff' 
            });
            const detailedImgData = detailedCanvas.toDataURL('image/png');
            const detailedProps = pdf.getImageProperties(detailedImgData);
            
            // التعديل لفرض صفحة واحدة
            const tableWidth = pdfWidth - 10;
            const tableHeight = tableWidth / (detailedProps.width / detailedProps.height);
            
            // إذا كان جدول السجل لا يتسع بالكامل، سنقسمه على صفحة جديدة
            if (yPosition + tableHeight > pdfHeight - 10) {
                 pdf.addPage('a4', 'landscape');
                 yPosition = 10; // ابدأ من أعلى الصفحة الجديدة
                 addWatermark(pdf); // إضافة العلامة المائية للصفحة الجديدة
            }

            pdf.addImage(detailedImgData, 'PNG', 5, yPosition, tableWidth, tableHeight);

            
            pdf.save(`Trading_Report_${dateStr}.pdf`);
            
            setExportMessage('✅ تم تصدير ملف PDF بنجاح.');

        } catch (error) {
            console.error('PDF export failed:', error);
            setExportMessage(`❌ فشل التصدير: ${error.message}. يرجى المحاولة مرة أخرى.`);
        } finally {
            // إعادة إظهار العناصر المخفية
            const button = document.getElementById('export-button');
            const messageDiv = document.getElementById('export-message-div');
            const deleteHeaders = document.querySelectorAll('.delete-header, .delete-cell');
            
            deleteHeaders.forEach(el => el.style.display = '');

            if (button) button.style.display = 'flex'; 
            if (messageDiv) messageDiv.style.display = 'block';

            setIsExporting(false);
            setTimeout(() => setExportMessage(''), 5000);
        }
    };


    return (
        <div className="space-y-8">
            {/* زر التصدير */}
            <div className="flex justify-end p-2">
                <button
                    id="export-button"
                    onClick={generatePDF}
                    // تعطيل الزر فقط إذا كان يتم التصدير، أو لا توجد صفقات مغلقة
                    disabled={isExporting || closedTradesDetails.length === 0}
                    className="flex items-center px-6 py-2 text-white bg-pink-600 rounded-lg hover:bg-pink-700 transition duration-300 disabled:opacity-50 shadow-md"
                >
                    <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    {isExporting ? 'جاري التحضير...' : 'تصدير النتائج كملف PDF'}
                </button>
            </div>

            {exportMessage && (
                <div id="export-message-div" className={`p-3 text-center font-semibold rounded-lg ${exportMessage.includes('نجاح') ? 'bg-green-100 text-green-700' : exportMessage.includes('فشل') ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {exportMessage}
                </div>
            )}
            
            {/* ========================================================== */}
            {/* 1. جدول الملخص الإحصائي (جديد) */}
            {/* ========================================================== */}
            <div id="summary-table-container">
                <div className="p-6 bg-white rounded-xl shadow-lg">
                    <h3 className="text-xl font-bold mb-4 text-gray-700">ملخص الأداء الإجمالي</h3>
                    <table className="min-w-full divide-y divide-gray-200" style={{ direction: 'rtl', textAlign: 'right' }}>
                        <tbody className="bg-white divide-y divide-gray-200 text-sm">
                            <tr>
                                <td className="px-3 py-2 font-semibold bg-gray-50">إجمالي الصفقات المغلقة</td>
                                <td className="px-3 py-2 text-center font-extrabold">{closedTradesDetails.length}</td>
                                <td className="px-3 py-2 font-semibold bg-gray-50">صافي النقاط</td>
                                <td className="px-3 py-2 text-center font-extrabold" style={{ color: totalPoints > 0 ? '#10B981' : totalPoints < 0 ? '#EF4444' : '#4B5563' }}>{formatPoints(totalPoints)}</td>
                            </tr>
                            <tr>
                                <td className="px-3 py-2 font-semibold bg-gray-50">معدل الربح</td>
                                <td className="px-3 py-2 text-center font-extrabold text-indigo-700">{winRate.toFixed(1)}% ({totalWins} رابحة / {totalLosses} خاسرة)</td>
                                <td className="px-3 py-2 font-semibold bg-gray-50">صافي الدولارات ($)</td>
                                <td className="px-3 py-2 text-center font-extrabold" style={{ color: totalDollarProfit > 0 ? '#10B981' : totalDollarProfit < 0 ? '#EF4444' : '#4B5563' }}>{formatDollar(totalDollarProfit)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ========================================================== */}
            {/* 2. جدول السجل التفصيلي (نتائج الصفقات الأسبوعية) */}
            {/* ========================================================== */}
            <div id="detailed-table-container">

                <div className="p-6 bg-white rounded-xl shadow-lg mt-8">
                    <h3 className="text-xl font-bold mb-4 text-indigo-700">سجل نتائج الصفقات التفصيلي</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200" style={{ direction: 'rtl', textAlign: 'right' }}>
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">الأداة</th>
                                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">النوع</th>
                                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">الإغلاق</th>
                                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">سعر الخروج</th>
                                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">النقاط</th>
                                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">الربح بالدولار ($)</th>
                                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase delete-header">حذف</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200 text-sm">
                                {closedTradesDetails.map((trade) => (
                                    <tr key={trade.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 whitespace-nowrap font-semibold">{trade.symbol}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${trade.type === 'BUY' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                                {trade.type === 'BUY' ? 'شراء' : 'بيع'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-700">{trade.outcome}</td>
                                        <td className="px-3 py-2 whitespace-nowrap font-mono text-gray-600">{trade.exitPrice}</td>
                                        <td className="px-3 py-2 whitespace-nowrap font-bold" style={{ color: trade.points > 0 ? '#10B981' : trade.points < 0 ? '#EF4444' : '#4B5563' }}>
                                            {formatPoints(trade.points)}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap font-bold" style={{ color: trade.dollarProfit > 0 ? '#10B981' : trade.dollarProfit < 0 ? '#EF4444' : '#4B5563' }}>
                                            {formatDollar(trade.dollarProfit)}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap delete-cell">
                                            <button
                                                onClick={() => handleConfirmDelete(trade)}
                                                className="p-1 text-gray-400 hover:text-red-500 transition"
                                                title="حذف الصفقة"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {closedTradesDetails.length === 0 && (
                                    <tr>
                                        <td colSpan="7" className="px-6 py-4 text-center text-gray-500">لا توجد صفقات مغلقة بعد لعرض السجل.</td>
                                    </tr>
                                )}
                            </tbody>
                            
                            {/* صف الإجماليات: تم ضغطه وإعادة كتابته لضمان سلامة الـ DOM */}
                            {closedTradesDetails.length > 0 ? (<tfoot className="border-t-4 border-indigo-600 bg-indigo-50"><tr className="whitespace-nowrap"><td colSpan="4" className="px-3 py-3 text-lg font-extrabold text-indigo-800 text-center">الإجمالي</td><td className="px-3 py-3 text-lg font-extrabold" style={{ color: totalPoints > 0 ? '#10B981' : totalPoints < 0 ? '#EF4444' : '#4B5563' }}>{formatPoints(totalPoints)} نقطة</td><td className="px-3 py-3 text-lg font-extrabold" style={{ color: totalDollarProfit > 0 ? '#10B981' : totalDollarProfit < 0 ? '#EF4444' : '#4B5563' }}>{formatDollar(totalDollarProfit)}</td><td className="px-3 py-3 delete-cell"></td></tr></tfoot>) : null}
                        </table>
                    </div>
                </div>
            </div>
             
            /* نافذة تأكيد الحذف */
            <ConfirmModal 
                isOpen={!!tradeToDelete}
                message={`هل أنت متأكد من حذف الصفقة #${tradeToDelete?.id?.substring(0, 4)} لـ ${tradeToDelete?.symbol}؟ لا يمكن التراجع عن هذا الإجراء.`}
                onConfirm={handleDeleteTrade}
                onCancel={() => setTradeToDelete(null)}
            />
        </div>
    );
};


/**
 * المكون الرئيسي للتطبيق
 */
const App = () => {
    // تم حذف Firebase بالكامل وتم الاعتماد على حالة React المحلية
    const [trades, setTrades] = useState([]);
    const [activeTab, setActiveTab] = useState('newTrade'); 

    // منطق تحديث الصفقات في الذاكرة
    const handleAddTrade = useCallback((newTrade) => {
        setTrades(prevTrades => [newTrade, ...prevTrades]);
    }, []);

    const handleUpdateTrade = useCallback((updatedTrade) => {
        setTrades(prevTrades => 
            prevTrades.map(t => t.id === updatedTrade.id ? updatedTrade : t)
        );
    }, []);

    const handleDeleteTrade = useCallback((tradeId) => {
        setTrades(prevTrades => prevTrades.filter(t => t.id !== tradeId));
    }, []);


    // 3. حساب الإحصائيات الرئيسية
    const { totalPoints, totalDollarProfit, closedTradesCount, openTrades, winRate } = useMemo(() => {
        const closed = trades.filter(t => t.status === 'CLOSED');
        const open = trades.filter(t => t.status === 'OPEN');
        
        const totalP = closed.reduce((sum, t) => sum + (t.points || 0), 0);
        const totalDP = closed.reduce((sum, t) => sum + (t.dollarProfit || 0), 0); 
        const totalW = closed.filter(t => (t.points || 0) > 0).length;
        const totalC = closed.length;
        
        const winR = totalC > 0 ? (totalW / totalC) * 100 : 0;
        
        return {
            totalPoints: totalP,
            totalDollarProfit: totalDP,
            closedTradesCount: totalC,
            openTrades: open,
            winRate: winR,
        };
    }, [trades]);

    // تنسيق قيمة النقاط للعرض
    const formatPointsDisplay = (points) => {
        const fixed = points.toFixed(2);
        if (points > 0) return `+${fixed}`;
        if (points < 0) return fixed;
        return '0.00';
    };

    const pointsColor = totalPoints > 0 ? 'bg-emerald-600 text-white' : totalPoints < 0 ? 'bg-rose-600 text-white' : 'bg-gray-200 text-gray-800';

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-cairo" style={{ fontFamily: 'Cairo, sans-serif', direction: 'rtl' }}>
            
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap');
                body {
                    font-family: 'Cairo', sans-serif;
                }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                `}
            </style>
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-extrabold text-indigo-800 mb-6 border-b pb-2">
                    حاسبة نتائج الصفقات
                </h1>
                
                {/* 4. لوحة الإحصائيات العامة (Dashboard) */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <StatCard 
                        title="صافي النقاط الإجمالي"
                        value={`${formatPointsDisplay(totalPoints)} نقطة`}
                        colorClass={pointsColor}
                    />
                    <StatCard 
                        title="إجمالي الصفقات المغلقة" 
                        value={closedTradesCount} 
                        colorClass="bg-indigo-600 text-white"
                    />
                    <StatCard 
                        title="معدل الربح" 
                        value={`${winRate.toFixed(1)}%`} 
                        colorClass="bg-yellow-100 text-yellow-800"
                    />
                     <StatCard 
                        title="صافي الدولارات الإجمالي" 
                        value={`$${totalDollarProfit.toFixed(2)}`} 
                        colorClass="bg-blue-100 text-blue-800"
                    />
                </div>

                {/* 5. نظام التبويبات (Tabs) */}
                <div className="mb-6 bg-white p-2 rounded-xl shadow-md flex space-x-2 space-x-reverse">
                    <TabButton title="السجل والإجماليات" id="dashboard" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabButton title="إضافة صفقة (لصق)" id="newTrade" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabButton title="إغلاق صفقة" id="openTrades" activeTab={activeTab} setActiveTab={setActiveTab} />
                </div>

                {/* 6. محتوى التبويبات */}
                <div className="mt-6">
                    {activeTab === 'dashboard' && <WeeklyReport trades={trades} onDeleteTrade={handleDeleteTrade} />}
                    {activeTab === 'newTrade' && <NewTradeForm onAddTrade={handleAddTrade} />}
                    {activeTab === 'openTrades' && <OpenTradesList openTrades={openTrades} onUpdateTrade={handleUpdateTrade} onDeleteTrade={handleDeleteTrade} />}
                </div>

                /* تمت إزالة ملاحظة معرف المستخدم */
            </div>
        </div>
    );
};

// مكون زر التبويب
const TabButton = ({ title, id, activeTab, setActiveTab }) => (
    <button
        onClick={() => setActiveTab(id)}
        className={`flex-1 py-2 px-4 text-sm md:text-base font-semibold rounded-lg transition-all duration-200 ${
            activeTab === id
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100'
        }`}
    >
        {title}
    </button>
);

export default App;
