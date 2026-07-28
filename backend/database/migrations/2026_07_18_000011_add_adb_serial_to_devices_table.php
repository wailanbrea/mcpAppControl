<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::table('devices', function (Blueprint $table) {
            $table->string('adb_serial', 128)->nullable()->unique()->after('serial_number');
        });
    }

    public function down(): void {
        Schema::table('devices', function (Blueprint $table) {
            $table->dropUnique(['adb_serial']);
            $table->dropColumn('adb_serial');
        });
    }
};
