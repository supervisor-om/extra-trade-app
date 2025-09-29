import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './App.css';
import { jsPDF } from 'jspdf';

// --- الثوابت الرئيسية ---
const POINTS_FACTOR = 1; 
const DOLLAR_PER_POINT = 0.1;

// --- بيانات اللوجو (تم تشفيرها إلى Base64) ---
// يرجى استبدال هذه البيانات بالـ Base64 الخاص بشعارك المفضل
const LOGO_BASE64_FOR_HEADER = "/9j/4AAQSkZJRgABAQEAYABgAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAEAAAAAAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAEAAQEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBgcIEyExURQiQhYjVHGQCcHRM,s/4y/9K/8AwA//9k="; 
// Base64 لشعار أكثر وضوحاً (للركن)
const HEADER_LOGO_BASE64 = LOGO_BASE64_FOR_HEADER;
const WATERMARK_TEXT = "EXTRA TRADE"; // النص الذي سيظهر كعلامة مائية

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

        // إنشاء صفقة جديدة
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
                    ref={textAreaRef}
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
                        
                        <div className="flex flex-wrap gap-2 justify-end items-center">
                            {trade.tps.map((tp) => (
                                <button
                                    key={tp.name}
                                    onClick={() => handleCloseTrade(trade, tp.name)}
                                    className="py-1 px-3 text-sm bg-indigo-500 text-white rounded-md hover:bg-indigo-600 transition flex items-center justify-center shadow-md"
                                >
                                    {tp.name} ({tp.points > 0 ? '+' : ''}{tp.points})
                                </button>
                            ))}
                            
                            <button
                                onClick={() => handleCloseTrade(trade, 'SL')}
                                className="py-1 px-3 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition flex items-center justify-center shadow-md"
                            >
                                SL ({trade.slPoints})
                            </button>
                            
                            <button
                                onClick={() => handleConfirmDelete(trade)}
                                className="py-1 px-3 text-sm bg-gray-400 text-white rounded-md hover:bg-gray-500 transition flex items-center justify-center shadow-md"
                                title="حذف الصفقة"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            
            <ConfirmModal
                isOpen={!!tradeToDelete}
                message={`هل أنت متأكد من حذف الصفقة ${tradeToDelete?.symbol} (${tradeToDelete?.type})؟`}
                onConfirm={handleDeleteTrade}
                onCancel={() => setTradeToDelete(null)}
            />
        </div>
    );
};

/**
 * تقارير وإحصائيات الصفقات المغلقة
 */
const ReportsSection = ({ closedTrades, onDeleteTrade }) => {
    const [message, setMessage] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [exportMessage, setExportMessage] = useState('');
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

    const closedTradesDetails = useMemo(() => {
        return closedTrades.map(trade => {
            let exitPrice;
            if (trade.outcome === 'SL') {
                exitPrice = trade.sl;
            } else {
                const tpData = trade.tps.find(t => t.name === trade.outcome);
                exitPrice = tpData ? tpData.price : 'غير محدد';
            }
            
            return {
                ...trade,
                exitPrice: exitPrice
            };
        });
    }, [closedTrades]);

    const { totalPoints, totalDollarProfit, totalWins, totalLosses, winRate } = useMemo(() => {
        const totalPoints = closedTradesDetails.reduce((sum, trade) => sum + trade.points, 0);
        const totalDollarProfit = closedTradesDetails.reduce((sum, trade) => sum + trade.dollarProfit, 0);
        const totalWins = closedTradesDetails.filter(trade => trade.points > 0).length;
        const totalLosses = closedTradesDetails.filter(trade => trade.points <= 0).length;
        const winRate = closedTradesDetails.length > 0 ? (totalWins / closedTradesDetails.length) * 100 : 0;
        
        return { totalPoints, totalDollarProfit, totalWins, totalLosses, winRate };
    }, [closedTradesDetails]);

    const formatPoints = (points) => {
        return points > 0 ? `+${points.toFixed(2)}` : points.toFixed(2);
    };

    const formatDollar = (amount) => {
        return amount > 0 ? `+$${amount.toFixed(2)}` : `$${amount.toFixed(2)}`;
    };

    const generatePDF = () => {
        if (closedTradesDetails.length === 0) {
            setExportMessage('❌ لا توجد صفقات مغلقة للتصدير.');
            setTimeout(() => setExportMessage(''), 5000);
            return;
        }

        setIsExporting(true);
        setExportMessage('جاري تحضير ملف PDF...');

        try {
            const doc = new jsPDF();
            
            // إعداد الخط والاتجاه
            doc.setFont('helvetica');
            doc.setFontSize(16);
            
            // العنوان الرئيسي
            doc.text('EXTRA TRADE - Trading Report', 105, 20, { align: 'center' });
            doc.setFontSize(12);
            doc.text(`Report Date: ${new Date().toLocaleDateString('en-US')}`, 105, 30, { align: 'center' });
            
            // خط فاصل
            doc.line(20, 35, 190, 35);
            
            let yPosition = 50;
            
            // ملخص الأداء
            doc.setFontSize(14);
            doc.text('Performance Summary:', 20, yPosition);
            yPosition += 10;
            
            doc.setFontSize(10);
            doc.text(`Total Closed Trades: ${closedTradesDetails.length}`, 20, yPosition);
            yPosition += 7;
            doc.text(`Win Rate: ${winRate.toFixed(1)}% (${totalWins} wins / ${totalLosses} losses)`, 20, yPosition);
            yPosition += 7;
            doc.text(`Net Points: ${formatPoints(totalPoints)}`, 20, yPosition);
            yPosition += 7;
            doc.text(`Net Profit: ${formatDollar(totalDollarProfit)}`, 20, yPosition);
            yPosition += 15;
            
            // تفاصيل الصفقات
            doc.setFontSize(14);
            doc.text('Trade Details:', 20, yPosition);
            yPosition += 10;
            
            // رؤوس الجدول
            doc.setFontSize(9);
            doc.text('Symbol', 20, yPosition);
            doc.text('Type', 50, yPosition);
            doc.text('Exit', 75, yPosition);
            doc.text('Price', 100, yPosition);
            doc.text('Points', 130, yPosition);
            doc.text('Profit ($)', 160, yPosition);
            yPosition += 5;
            
            // خط تحت الرؤوس
            doc.line(20, yPosition, 190, yPosition);
            yPosition += 5;
            
            // بيانات الصفقات
            closedTradesDetails.forEach((trade, index) => {
                if (yPosition > 270) { // إضافة صفحة جديدة إذا امتلأت الصفحة
                    doc.addPage();
                    yPosition = 20;
                }
                
                doc.text(trade.symbol, 20, yPosition);
                doc.text(trade.type === 'BUY' ? 'Buy' : 'Sell', 50, yPosition);
                doc.text(trade.outcome, 75, yPosition);
                doc.text(trade.exitPrice.toString(), 100, yPosition);
                doc.text(formatPoints(trade.points), 130, yPosition);
                doc.text(formatDollar(trade.dollarProfit), 160, yPosition);
                yPosition += 7;
            });
            
            // الإجمالي
            yPosition += 10;
            doc.line(20, yPosition, 190, yPosition);
            yPosition += 7;
            doc.setFontSize(11);
            doc.text('TOTAL:', 20, yPosition);
            doc.text(`${formatPoints(totalPoints)} points`, 130, yPosition);
            doc.text(formatDollar(totalDollarProfit), 160, yPosition);
            
            // حفظ الملف
            const fileName = `Trading_Report_${new Date().toISOString().split('T')[0]}.pdf`;
            doc.save(fileName);

            setExportMessage('✅ تم تصدير تقرير PDF بنجاح!');
            setIsExporting(false);
        } catch (error) {
            console.error('PDF Export error:', error);
            setExportMessage('❌ فشل في تصدير تقرير PDF.');
            setIsExporting(false);
        } finally {
            setTimeout(() => setExportMessage(''), 5000);
        }
    };

    return (
        <div className="space-y-8">
            {/* زر التصدير */}
            <div className="flex justify-end p-2">
                <button
                    onClick={generatePDF}
                    disabled={isExporting || closedTradesDetails.length === 0}
                    className="flex items-center px-6 py-2 text-white bg-pink-600 rounded-lg hover:bg-pink-700 transition duration-300 disabled:opacity-50 shadow-md"
                >
                    <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    {isExporting ? 'جاري التحضير...' : 'تصدير النتائج كملف PDF'}
                </button>
            </div>

            {exportMessage && (
                <div className={`p-3 text-center font-semibold rounded-lg ${exportMessage.includes('نجاح') ? 'bg-green-100 text-green-700' : exportMessage.includes('فشل') ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {exportMessage}
                </div>
            )}
            
            {/* جدول الملخص الإحصائي */}
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

            {/* جدول السجل التفصيلي */}
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
                                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">حذف</th>
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
                                        <td className="px-3 py-2 whitespace-nowrap">
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
                            
                            {closedTradesDetails.length > 0 && (
                                <tfoot className="border-t-4 border-indigo-600 bg-indigo-50">
                                    <tr>
                                        <td colSpan="4" className="px-3 py-3 text-lg font-extrabold text-indigo-800 text-center">الإجمالي</td>
                                        <td className="px-3 py-3 text-lg font-extrabold" style={{ color: totalPoints > 0 ? '#10B981' : totalPoints < 0 ? '#EF4444' : '#4B5563' }}>
                                            {formatPoints(totalPoints)} نقطة
                                        </td>
                                        <td className="px-3 py-3 text-lg font-extrabold" style={{ color: totalDollarProfit > 0 ? '#10B981' : totalDollarProfit < 0 ? '#EF4444' : '#4B5563' }}>
                                            {formatDollar(totalDollarProfit)}
                                        </td>
                                        <td className="px-3 py-3"></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            </div>
            
            <ConfirmModal
                isOpen={!!tradeToDelete}
                message={`هل أنت متأكد من حذف الصفقة ${tradeToDelete?.symbol} (${tradeToDelete?.type})؟`}
                onConfirm={handleDeleteTrade}
                onCancel={() => setTradeToDelete(null)}
            />
        </div>
    );
};

// --- المكون الرئيسي ---
function App() {
    const [trades, setTrades] = useState([]);
    const [activeTab, setActiveTab] = useState('add');

    const addTrade = useCallback((newTrade) => {
        setTrades(prev => [...prev, newTrade]);
    }, []);

    const updateTrade = useCallback((updatedTrade) => {
        setTrades(prev => prev.map(trade => 
            trade.id === updatedTrade.id ? updatedTrade : trade
        ));
    }, []);

    const deleteTrade = useCallback((tradeId) => {
        setTrades(prev => prev.filter(trade => trade.id !== tradeId));
    }, []);

    const openTrades = useMemo(() => 
        trades.filter(trade => trade.status === 'OPEN'), [trades]
    );

    const closedTrades = useMemo(() => 
        trades.filter(trade => trade.status === 'CLOSED'), [trades]
    );

    const { totalPoints, totalDollarProfit, totalWins, totalLosses } = useMemo(() => {
        const totalPoints = closedTrades.reduce((sum, trade) => sum + trade.points, 0);
        const totalDollarProfit = closedTrades.reduce((sum, trade) => sum + trade.dollarProfit, 0);
        const totalWins = closedTrades.filter(trade => trade.points > 0).length;
        const totalLosses = closedTrades.filter(trade => trade.points <= 0).length;
        
        return { totalPoints, totalDollarProfit, totalWins, totalLosses };
    }, [closedTrades]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50" style={{ direction: 'rtl' }}>
            {/* Header */}
            <header className="bg-white shadow-lg border-b-4 border-indigo-600">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 space-x-reverse">
                            <img 
                                src={`data:image/jpeg;base64,${HEADER_LOGO_BASE64}`} 
                                alt="Logo" 
                                className="h-12 w-12 rounded-lg shadow-md"
                            />
                            <div>
                                <h1 className="text-3xl font-extrabold text-gray-900">EXTRA TRADE</h1>
                                <p className="text-sm text-gray-600 font-medium">نظام إدارة الصفقات التجارية</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-gray-500">البيانات محلية - لن تحفظ عند التحديث</p>
                        </div>
                    </div>
                </div>
            </header>

            {/* Stats Cards */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatCard 
                        title="الصفقات المفتوحة" 
                        value={openTrades.length} 
                        colorClass="bg-gradient-to-r from-blue-500 to-blue-600 text-white" 
                    />
                    <StatCard 
                        title="الصفقات المغلقة" 
                        value={closedTrades.length} 
                        colorClass="bg-gradient-to-r from-gray-500 to-gray-600 text-white" 
                    />
                    <StatCard 
                        title="إجمالي النقاط" 
                        value={totalPoints > 0 ? `+${totalPoints.toFixed(2)}` : totalPoints.toFixed(2)} 
                        colorClass={`bg-gradient-to-r ${totalPoints >= 0 ? 'from-emerald-500 to-emerald-600' : 'from-red-500 to-red-600'} text-white`} 
                    />
                    <StatCard 
                        title="إجمالي الربح ($)" 
                        value={totalDollarProfit > 0 ? `+$${totalDollarProfit.toFixed(2)}` : `$${totalDollarProfit.toFixed(2)}`} 
                        colorClass={`bg-gradient-to-r ${totalDollarProfit >= 0 ? 'from-green-500 to-green-600' : 'from-rose-500 to-rose-600'} text-white`} 
                    />
                </div>

                {/* Navigation Tabs */}
                <div className="bg-white rounded-xl shadow-lg mb-8">
                    <div className="border-b border-gray-200">
                        <nav className="flex space-x-8 space-x-reverse px-6">
                            <button
                                onClick={() => setActiveTab('add')}
                                className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                                    activeTab === 'add'
                                        ? 'border-indigo-500 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                إضافة صفقة جديدة
                            </button>
                            <button
                                onClick={() => setActiveTab('open')}
                                className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                                    activeTab === 'open'
                                        ? 'border-indigo-500 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                الصفقات المفتوحة ({openTrades.length})
                            </button>
                            <button
                                onClick={() => setActiveTab('reports')}
                                className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                                    activeTab === 'reports'
                                        ? 'border-indigo-500 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                التقارير والإحصائيات
                            </button>
                        </nav>
                    </div>

                    {/* Tab Content */}
                    <div className="p-6">
                        {activeTab === 'add' && (
                            <NewTradeForm onAddTrade={addTrade} />
                        )}
                        
                        {activeTab === 'open' && (
                            <OpenTradesList 
                                openTrades={openTrades}
                                onUpdateTrade={updateTrade}
                                onDeleteTrade={deleteTrade}
                            />
                        )}
                        
                        {activeTab === 'reports' && (
                            <ReportsSection 
                                closedTrades={closedTrades}
                                onDeleteTrade={deleteTrade}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <footer className="bg-white border-t border-gray-200 mt-16">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="text-center">
                        <p className="text-lg font-bold text-gray-800">EXTRA TRADE</p>
                        <p className="text-sm text-gray-600 mt-1">
                            نظام إدارة الصفقات التجارية المتقدم
                        </p>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                        نظام إدارة الصفقات التجارية - البيانات محفوظة محلياً فقط
                    </p>
                </div>
            </footer>
        </div>
    );
}

export default App;
