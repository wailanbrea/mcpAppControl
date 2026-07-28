<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApplicationSmokeTest extends TestCase
{
    public function test_dashboard_is_served_from_the_application_root(): void
    {
        $response = $this->get('/');

        $response->assertOk();
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    }

    public function test_health_endpoint_is_available(): void
    {
        $this->get('/up')->assertOk();
    }

    public function test_api_rejects_requests_without_a_token(): void
    {
        $this->getJson('/api/v1/devices')
            ->assertUnauthorized()
            ->assertJson([
                'success' => false,
                'message' => 'Missing API token',
            ]);
    }
}
